package com.github.continuedev.continueintellijextension.auth

import com.google.gson.Gson
import com.intellij.credentialStore.CredentialAttributes
import com.intellij.credentialStore.Credentials
import com.intellij.ide.BrowserUtil
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.io.File
import java.net.BindException
import java.net.InetSocketAddress
import java.net.URI
import java.net.URLDecoder
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.attribute.PosixFilePermission
import java.nio.file.attribute.PosixFilePermissions
import java.security.SecureRandom
import java.util.concurrent.atomic.AtomicReference

/**
 * Phase 7 — JetBrains web-first sign-in.
 *
 * Mirrors the VS Code and CLI flows. Hands off to the AI Firewall web
 * dashboard via the proxy's `/web-login-start` bridge with a loopback
 * callback server on 127.0.0.1:19837 (one port up from the CLI so
 * both can run side-by-side). The shared bearer token lives in two
 * places:
 *
 *   1. IntelliJ PasswordSafe (this IDE only, encrypted)
 *   2. `~/.ai-firewall/auth.json` (shared with CLI + VS Code)
 *
 * On startup the service prefers PasswordSafe, then falls back to the
 * shared file — so a user who signed in via `cn login` is already
 * signed in when they open IntelliJ.
 *
 * We deliberately use `com.sun.net.httpserver.HttpServer` (shipped
 * with the JDK) instead of Ktor or another dep so this code adds
 * zero new plugin dependencies.
 */
@Service
class AiFirewallAuthService {
    private val log = Logger.getInstance(AiFirewallAuthService::class.java)
    private val gson = Gson()
    private val httpClient: HttpClient = HttpClient.newBuilder().build()

    companion object {
        private const val CREDENTIALS_USER = "AiFirewallAuthUser"
        private const val TOKEN_KEY = "AiFirewallAuthToken.v1"
        private const val LOOPBACK_PORT_START = 19837
        private const val LOOPBACK_PORT_RANGE = 10
        private const val SIGN_IN_TIMEOUT_MS = 5 * 60 * 1000L
    }

    data class AuthState(
        val signedIn: Boolean,
        val token: String? = null,
        val email: String? = null,
        val userId: Int? = null,
        val role: String? = null,
        val proxyUrl: String? = null,
    )

    private val currentState = AtomicReference(AuthState(signedIn = false))

    init {
        // Load cached token on first access — best-effort, never blocks
        // construction. PasswordSafe reads are fast; the shared file
        // read is a single small JSON parse.
        try {
            val restored = restoreFromCache()
            if (restored != null) {
                currentState.set(restored)
            }
        } catch (e: Exception) {
            log.warn("AiFirewallAuthService init failed: ${e.message}")
        }
    }

    fun getState(): AuthState = currentState.get()

    fun isSignedIn(): Boolean = currentState.get().signedIn

    fun getToken(): String? = currentState.get().token

    /**
     * Run the web-first sign-in flow. Opens the system browser, starts
     * a one-shot HTTP server on 127.0.0.1:<port>, waits for the web
     * dashboard to fetch `?token=...&state=...`. Thread-safe via the
     * atomic state reference.
     *
     * This blocks the calling thread — always invoke from a background
     * task (the IntelliJ action framework handles this for you via
     * `Task.Backgroundable`).
     */
    @Throws(Exception::class)
    fun signInBlocking(proxyUrl: String): AuthState {
        val stateNonce = generateStateNonce()
        val (server, port) = startLoopbackServer(stateNonce)

        try {
            val signInUrl = buildString {
                append(proxyUrl.trimEnd('/'))
                append("/web-login-start?return=jetbrains")
                append("&port=").append(port)
                append("&state=").append(stateNonce)
            }
            log.info("AiFirewall sign-in: opening $signInUrl (loopback $port)")
            BrowserUtil.browse(signInUrl)

            val token = server.waitForToken(SIGN_IN_TIMEOUT_MS)
                ?: throw IllegalStateException("Sign-in timed out waiting for browser callback")

            // Fetch user record from the proxy so we can display a
            // useful "signed in as foo@bar" message and write the
            // shared file with the right orgId / role.
            val userInfo = fetchMe(proxyUrl, token)
            val newState = AuthState(
                signedIn = true,
                token = token,
                email = userInfo.email,
                userId = userInfo.id,
                role = userInfo.role,
                proxyUrl = proxyUrl,
            )
            currentState.set(newState)

            // Persist in both places. Shared file is best-effort.
            persistToPasswordSafe(newState)
            try {
                writeSharedAuthFile(newState)
            } catch (e: Exception) {
                log.warn("Writing shared auth file failed (non-fatal): ${e.message}")
            }

            return newState
        } finally {
            server.stop()
        }
    }

    /**
     * Sign out: revoke the token on the proxy (best-effort), wipe
     * PasswordSafe, delete the shared auth file. Always returns
     * success from the caller's perspective — partial failure still
     * clears local state.
     */
    fun signOut() {
        val state = currentState.get()
        val token = state.token
        val proxyUrl = state.proxyUrl ?: "http://localhost:8080"

        if (token != null) {
            try {
                val req = HttpRequest.newBuilder()
                    .uri(URI.create("$proxyUrl/api/auth/logout"))
                    .header("Authorization", "Bearer $token")
                    .POST(HttpRequest.BodyPublishers.noBody())
                    .build()
                httpClient.send(req, HttpResponse.BodyHandlers.discarding())
            } catch (e: Exception) {
                log.info("Proxy logout failed (offline?): ${e.message}")
            }
        }

        try {
            PasswordSafe.instance.set(credentialAttrs(), null)
        } catch (e: Exception) {
            log.warn("PasswordSafe clear failed: ${e.message}")
        }

        try {
            val file = sharedAuthFile()
            if (Files.exists(file)) Files.delete(file)
        } catch (e: Exception) {
            log.warn("Shared auth file delete failed: ${e.message}")
        }

        currentState.set(AuthState(signedIn = false))
    }

    // ─── helpers ──────────────────────────────────────────────────────

    private fun credentialAttrs(): CredentialAttributes =
        CredentialAttributes("AiFirewall", TOKEN_KEY)

    private fun restoreFromCache(): AuthState? {
        // Try PasswordSafe first (fastest, IDE-scoped)
        val creds: Credentials? = PasswordSafe.instance.get(credentialAttrs())
        val passwordJson = creds?.getPasswordAsString()
        if (!passwordJson.isNullOrBlank()) {
            val fromSafe = runCatching {
                gson.fromJson(passwordJson, SharedAuthFileShape::class.java)
            }.getOrNull()
            if (fromSafe?.accessToken != null) {
                return AuthState(
                    signedIn = true,
                    token = fromSafe.accessToken,
                    email = fromSafe.user?.email,
                    userId = fromSafe.user?.id,
                    role = fromSafe.user?.role,
                    proxyUrl = fromSafe.proxyUrl,
                )
            }
        }

        // Fall back to the shared ~/.ai-firewall/auth.json file
        val file = sharedAuthFile()
        if (Files.exists(file)) {
            val text = Files.readString(file)
            val shared = runCatching {
                gson.fromJson(text, SharedAuthFileShape::class.java)
            }.getOrNull()
            if (shared?.accessToken != null) {
                // Warm the PasswordSafe cache for next boot
                persistToPasswordSafe(
                    AuthState(
                        signedIn = true,
                        token = shared.accessToken,
                        email = shared.user?.email,
                        userId = shared.user?.id,
                        role = shared.user?.role,
                        proxyUrl = shared.proxyUrl,
                    )
                )
                return AuthState(
                    signedIn = true,
                    token = shared.accessToken,
                    email = shared.user?.email,
                    userId = shared.user?.id,
                    role = shared.user?.role,
                    proxyUrl = shared.proxyUrl,
                )
            }
        }

        return null
    }

    private fun persistToPasswordSafe(state: AuthState) {
        val shape = SharedAuthFileShape(
            version = 1,
            proxyUrl = state.proxyUrl ?: "http://localhost:8080",
            accessToken = state.token,
            savedAt = System.currentTimeMillis(),
            savedBy = "jetbrains",
            onboardingComplete = null,
            user = UserShape(
                id = state.userId ?: 0,
                email = state.email ?: "",
                name = null,
                role = state.role ?: "developer",
                orgId = null,
            ),
        )
        val json = gson.toJson(shape)
        PasswordSafe.instance.set(credentialAttrs(), Credentials(CREDENTIALS_USER, json))
    }

    private fun sharedAuthFile(): Path {
        val home = System.getProperty("user.home")
        return Path.of(home, ".ai-firewall", "auth.json")
    }

    private fun writeSharedAuthFile(state: AuthState) {
        val file = sharedAuthFile()
        Files.createDirectories(file.parent)

        val shape = SharedAuthFileShape(
            version = 1,
            proxyUrl = state.proxyUrl ?: "http://localhost:8080",
            accessToken = state.token,
            savedAt = System.currentTimeMillis(),
            savedBy = "jetbrains",
            onboardingComplete = null,
            user = UserShape(
                id = state.userId ?: 0,
                email = state.email ?: "",
                name = null,
                role = state.role ?: "developer",
                orgId = null,
            ),
        )
        val json = gson.toJson(shape)

        // Atomic write: write to .tmp then rename
        val tmp = File(file.parent.toFile(), "auth.json.tmp")
        tmp.writeText(json, StandardCharsets.UTF_8)

        // Apply 600 perms on POSIX platforms BEFORE the rename so the
        // window between create + chmod is minimised.
        try {
            val perms = PosixFilePermissions.fromString("rw-------")
            Files.setPosixFilePermissions(tmp.toPath(), perms)
        } catch (_: UnsupportedOperationException) {
            // Windows has no POSIX — relies on ACL defaults instead.
        }

        Files.move(
            tmp.toPath(),
            file,
            java.nio.file.StandardCopyOption.REPLACE_EXISTING,
            java.nio.file.StandardCopyOption.ATOMIC_MOVE,
        )
    }

    private data class MeResponse(val user: MeUser)
    private data class MeUser(
        val id: Int,
        val email: String,
        val name: String?,
        val role: String?,
        val orgId: Int?,
    )

    private fun fetchMe(proxyUrl: String, token: String): MeUser {
        val req = HttpRequest.newBuilder()
            .uri(URI.create("${proxyUrl.trimEnd('/')}/api/auth/me"))
            .header("Authorization", "Bearer $token")
            .GET()
            .build()
        val res = httpClient.send(req, HttpResponse.BodyHandlers.ofString())
        if (res.statusCode() !in 200..299) {
            throw IllegalStateException("GET /api/auth/me failed: HTTP ${res.statusCode()}")
        }
        val body = gson.fromJson(res.body(), MeResponse::class.java)
        return body.user
    }

    private fun generateStateNonce(): String {
        val bytes = ByteArray(16)
        SecureRandom().nextBytes(bytes)
        return bytes.joinToString("") { "%02x".format(it) }
    }

    // ─── loopback server ──────────────────────────────────────────────

    private class LoopbackServer(
        private val server: HttpServer,
        private val expectedState: String,
    ) {
        val port: Int get() = server.address.port

        @Volatile
        private var token: String? = null
        private val lock = java.util.concurrent.locks.ReentrantLock()
        private val condition = lock.newCondition()

        init {
            server.createContext("/") { exchange: HttpExchange ->
                // CORS — the web dashboard is on a different origin
                val headers = exchange.responseHeaders
                headers.add("Access-Control-Allow-Origin", "*")
                headers.add("Access-Control-Allow-Methods", "GET,OPTIONS")
                headers.add("Access-Control-Allow-Headers", "Content-Type")

                if (exchange.requestMethod == "OPTIONS") {
                    exchange.sendResponseHeaders(204, -1)
                    exchange.close()
                    return@createContext
                }

                val query = exchange.requestURI.rawQuery ?: ""
                val params = parseQuery(query)
                val incomingToken = params["token"]
                val incomingState = params["state"]

                if (incomingToken == null) {
                    writeHtml(exchange, 400, errorHtml)
                    return@createContext
                }
                if (incomingState == null || incomingState != expectedState) {
                    writeHtml(exchange, 400, errorHtml)
                    return@createContext
                }

                writeHtml(exchange, 200, successHtml)

                lock.lock()
                try {
                    token = incomingToken
                    condition.signalAll()
                } finally {
                    lock.unlock()
                }
            }
        }

        fun waitForToken(timeoutMs: Long): String? {
            val deadline = System.currentTimeMillis() + timeoutMs
            lock.lock()
            try {
                while (token == null) {
                    val remaining = deadline - System.currentTimeMillis()
                    if (remaining <= 0) return null
                    condition.await(remaining, java.util.concurrent.TimeUnit.MILLISECONDS)
                }
                return token
            } finally {
                lock.unlock()
            }
        }

        fun stop() {
            try {
                server.stop(0)
            } catch (_: Exception) {
                // ignore
            }
        }

        private fun writeHtml(exchange: HttpExchange, code: Int, body: String) {
            val bytes = body.toByteArray(StandardCharsets.UTF_8)
            exchange.responseHeaders.add("Content-Type", "text/html; charset=utf-8")
            exchange.sendResponseHeaders(code, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }

        private fun parseQuery(raw: String): Map<String, String> {
            if (raw.isEmpty()) return emptyMap()
            val out = mutableMapOf<String, String>()
            for (pair in raw.split("&")) {
                val idx = pair.indexOf('=')
                if (idx < 0) continue
                val k = URLDecoder.decode(pair.substring(0, idx), StandardCharsets.UTF_8)
                val v = URLDecoder.decode(pair.substring(idx + 1), StandardCharsets.UTF_8)
                out[k] = v
            }
            return out
        }

        companion object {
            private val successHtml = """
                <!doctype html>
                <html><head><meta charset="utf-8"><title>Signed in</title>
                <style>body{font-family:system-ui,sans-serif;background:#0b0f19;color:#e5e7eb;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
                .card{background:#111827;border:1px solid #1f2937;border-radius:16px;padding:32px 40px;text-align:center;max-width:420px}
                h1{margin:0 0 8px;font-size:20px;color:#34d399}
                p{margin:0;color:#9ca3af;font-size:14px}</style></head>
                <body><div class="card"><h1>You're signed in</h1><p>You can close this tab and return to your IDE.</p></div></body></html>
            """.trimIndent()

            private val errorHtml = """
                <!doctype html>
                <html><head><meta charset="utf-8"><title>Sign-in failed</title></head>
                <body style="font-family:system-ui,sans-serif">Sign-in failed. Please return to your IDE and try again.</body></html>
            """.trimIndent()
        }
    }

    private fun startLoopbackServer(stateNonce: String): Pair<LoopbackServer, Int> {
        var port = LOOPBACK_PORT_START
        var lastErr: Exception? = null
        while (port < LOOPBACK_PORT_START + LOOPBACK_PORT_RANGE) {
            try {
                val httpServer = HttpServer.create(InetSocketAddress("127.0.0.1", port), 0)
                val loopback = LoopbackServer(httpServer, stateNonce)
                httpServer.executor = null
                httpServer.start()
                return loopback to port
            } catch (e: BindException) {
                lastErr = e
                port += 1
            } catch (e: Exception) {
                throw e
            }
        }
        throw IllegalStateException(
            "Could not bind loopback server on any port in " +
                "[$LOOPBACK_PORT_START..${LOOPBACK_PORT_START + LOOPBACK_PORT_RANGE})",
            lastErr,
        )
    }

    // Shape of ~/.ai-firewall/auth.json — mirrors the TypeScript
    // `SharedAuthFile` interface in `packages/shared-auth`. Kept as a
    // plain data class so Gson can serialize it without reflection
    // surprises.
    private data class SharedAuthFileShape(
        val version: Int,
        val proxyUrl: String,
        val accessToken: String?,
        val user: UserShape?,
        val savedAt: Long,
        val savedBy: String,
        val onboardingComplete: Boolean?,
    )

    private data class UserShape(
        val id: Int,
        val email: String,
        val name: String?,
        val role: String,
        val orgId: Int?,
    )
}
