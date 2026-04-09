package com.github.continuedev.continueintellijextension.security

import com.github.continuedev.continueintellijextension.auth.AiFirewallAuthService
import com.google.gson.Gson
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.Logger
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.util.concurrent.atomic.AtomicReference

/**
 * Phase E — JetBrains file-scope enforcement.
 *
 * Mirrors the VS Code `fileRestrictionChecker.ts` module. On
 * sign-in (or at plugin startup if a token is already cached),
 * fetches `/api/me/policy` from the proxy with the user's bearer
 * token and extracts `file_scope`. Every downstream file-read
 * path that should respect the policy calls `isFileRestricted()`
 * before handing bytes to the agent.
 *
 * Uses JDK-built-in `java.net.http.HttpClient` and `com.google.gson`
 * so the plugin doesn't pull in another HTTP or JSON dependency.
 *
 * IMPORTANT: without a call to `refresh()`, the cache is empty and
 * `isFileRestricted()` returns false. This is fail-open — the
 * agent gets normal behaviour when the proxy is unreachable. If
 * your org needs fail-closed, the effective policy should carry
 * an explicit `file_scope.fail_mode: "closed"` flag (honoured by
 * the scanner pipeline server-side, not by this local cache).
 */
@Service
class AiFirewallFileScopeService {
    private val log = Logger.getInstance(AiFirewallFileScopeService::class.java)
    private val gson = Gson()
    private val httpClient = HttpClient.newBuilder().build()

    data class FileScope(
        val mode: String = "blocklist",
        val blocklist: List<String> = emptyList(),
        val allowlist: List<String> = emptyList(),
    )

    private val cached = AtomicReference<FileScope?>(null)

    fun getScope(): FileScope? = cached.get()

    /**
     * Fetch `/api/me/policy` and cache the file_scope block. Safe
     * to call from any thread. Returns the resolved scope (or null
     * on network failure).
     */
    fun refresh(): FileScope? {
        val authService = service<AiFirewallAuthService>()
        val authState = authService.getState()
        if (!authState.signedIn || authState.token == null) {
            // No bearer → can't fetch role-aware policy. Leave the
            // cache as-is so a sign-out followed by a read still
            // uses the previous scope rather than none.
            return cached.get()
        }
        val proxyUrl = authState.proxyUrl ?: "http://localhost:8080"
        return try {
            val req = HttpRequest.newBuilder()
                .uri(URI.create("${proxyUrl.trimEnd('/')}/api/me/policy"))
                .header("Authorization", "Bearer ${authState.token}")
                .GET()
                .build()
            val res = httpClient.send(req, HttpResponse.BodyHandlers.ofString())
            if (res.statusCode() !in 200..299) {
                log.warn("GET /api/me/policy failed: HTTP ${res.statusCode()}")
                return cached.get()
            }
            val parsed = gson.fromJson(res.body(), PolicyResponse::class.java)
            val scope = parsed.policy?.file_scope ?: FileScope()
            cached.set(scope)
            scope
        } catch (e: Exception) {
            log.info("refresh file scope failed: ${e.message}")
            cached.get()
        }
    }

    /**
     * Check if a file path should be blocked by the cached scope.
     * Returns false when the cache is empty (fail-open). Blocklist
     * uses simple glob matching against a normalised path.
     */
    fun isFileRestricted(filePath: String): Boolean {
        val scope = cached.get() ?: return false
        val normalised = filePath.replace("\\", "/").trimStart('/')

        if (scope.mode == "allowlist" && scope.allowlist.isNotEmpty()) {
            val allowed = scope.allowlist.any { globMatch(normalised, it) }
            return !allowed
        }

        return scope.blocklist.any { globMatch(normalised, it) }
    }

    /**
     * Return a human-readable reason a file was blocked, or null
     * if it's allowed. Used by UI surfaces that want to show the
     * user why a specific file was rejected.
     */
    fun getRestrictionReason(filePath: String): String? {
        val scope = cached.get() ?: return null
        val normalised = filePath.replace("\\", "/").trimStart('/')

        if (scope.mode == "allowlist" && scope.allowlist.isNotEmpty()) {
            val allowed = scope.allowlist.any { globMatch(normalised, it) }
            if (!allowed) return "File is not in the allowed list"
        }

        for (pattern in scope.blocklist) {
            if (globMatch(normalised, pattern)) {
                return "File matches restricted pattern: $pattern"
            }
        }
        return null
    }

    /**
     * Clear the cache — called on sign-out so an ex-user's role
     * policy can't keep enforcing against the next anonymous or
     * different-user session.
     */
    fun clear() {
        cached.set(null)
    }

    /**
     * Simple glob → regex conversion covering `*`, `**`, and `?`.
     * Not a full picomatch implementation — matches how the
     * VS Code fallback path works when picomatch isn't present.
     */
    private fun globMatch(path: String, pattern: String): Boolean {
        val regex = buildString {
            append("^")
            var i = 0
            while (i < pattern.length) {
                val c = pattern[i]
                when {
                    c == '*' && i + 1 < pattern.length && pattern[i + 1] == '*' -> {
                        append(".*")
                        i += 2
                    }
                    c == '*' -> {
                        append("[^/]*")
                        i += 1
                    }
                    c == '?' -> {
                        append(".")
                        i += 1
                    }
                    "\\^$.|+()[]{}".contains(c) -> {
                        append("\\").append(c)
                        i += 1
                    }
                    else -> {
                        append(c)
                        i += 1
                    }
                }
            }
            append("$")
        }
        return Regex(regex).matches(path)
    }

    private data class PolicyResponse(val policy: PolicyShape?)
    private data class PolicyShape(val file_scope: FileScope?)

    companion object {
        /**
         * Convenience: schedule a refresh on the IntelliJ shared
         * background thread pool. Called from
         * `AiFirewallSignInAction` after a successful sign-in.
         */
        fun scheduleRefresh() {
            ApplicationManager.getApplication().executeOnPooledThread {
                service<AiFirewallFileScopeService>().refresh()
            }
        }
    }
}
