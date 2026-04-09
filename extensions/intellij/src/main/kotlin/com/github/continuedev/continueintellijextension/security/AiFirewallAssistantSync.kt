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
import java.nio.charset.StandardCharsets
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.StandardCopyOption
import java.nio.file.attribute.PosixFilePermissions
import java.security.MessageDigest

/**
 * Phase F2+ — JetBrains assistant sync.
 *
 * Mirrors `extensions/vscode/src/security/assistantSync.ts`.
 * Fetches `/api/me/assistant` from the proxy, receives a YAML
 * with provider API keys injected server-side, and writes it to
 * `~/.ai-firewall/config.yaml` so Continue core's JetBrains-side
 * `ConfigHandler` picks up the user's model list on the next
 * config refresh.
 *
 * Runs:
 *   1. Immediately after `AiFirewallSignInAction` succeeds
 *      (wired in `AiFirewallSignInAction.kt`)
 *   2. Every 10 minutes on the IntelliJ shared background pool
 *      as a safety net for changes made in the web dashboard
 *      while the IDE is open
 *
 * User-managed escape hatch: if the first 200 bytes of
 * `~/.ai-firewall/config.yaml` contain `# user-managed: true`,
 * sync is skipped and the file is left alone — for power users
 * who hand-edit YAML and don't want auto-sync to clobber them.
 */
@Service
class AiFirewallAssistantSyncService {
    private val log = Logger.getInstance(AiFirewallAssistantSyncService::class.java)
    private val gson = Gson()
    private val httpClient: HttpClient = HttpClient.newBuilder().build()

    companion object {
        private const val USER_MANAGED_MARKER = "# user-managed: true"
        private const val MANAGED_HEADER =
            "# Managed by AI Firewall — edit via the web dashboard.\n" +
                "# Add `# user-managed: true` on the first line to prevent auto-sync.\n"
    }

    sealed class SyncStatus {
        data class Ok(val fresh: Boolean) : SyncStatus()
        object NotSignedIn : SyncStatus()
        object UserManaged : SyncStatus()
        data class Error(val message: String) : SyncStatus()
    }

    private data class AssistantPayload(
        val slug: String,
        val name: String,
        val yaml: String,
        val etag: String,
        val isDefault: Boolean,
        val updatedAt: Long,
    )

    private data class AssistantResponse(val assistant: AssistantPayload)

    private fun homeDir(): Path = Path.of(System.getProperty("user.home"))
    private fun configYamlPath(): Path = homeDir().resolve(".ai-firewall").resolve("config.yaml")
    private fun cacheDir(): Path = homeDir().resolve(".ai-firewall").resolve("cache")
    private fun etagPath(): Path = cacheDir().resolve("intellij-assistant.etag")

    private fun readCachedEtag(): String? {
        return try {
            val p = etagPath()
            if (Files.exists(p)) Files.readString(p).trim() else null
        } catch (_: Exception) {
            null
        }
    }

    private fun writeCachedEtag(etag: String) {
        val dir = cacheDir()
        if (!Files.exists(dir)) Files.createDirectories(dir)
        val tmp = dir.resolve("intellij-assistant.etag.tmp")
        Files.writeString(tmp, etag, StandardCharsets.UTF_8)
        try {
            Files.setPosixFilePermissions(tmp, PosixFilePermissions.fromString("rw-------"))
        } catch (_: UnsupportedOperationException) {
            // Windows
        }
        Files.move(tmp, etagPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
    }

    private fun isUserManaged(): Boolean {
        return try {
            val p = configYamlPath()
            if (!Files.exists(p)) return false
            val head = Files.readString(p).take(200)
            head.contains(USER_MANAGED_MARKER)
        } catch (_: Exception) {
            false
        }
    }

    private fun writeConfigYaml(yaml: String) {
        val dir = configYamlPath().parent
        if (!Files.exists(dir)) Files.createDirectories(dir)
        val body = MANAGED_HEADER + yaml
        val tmp = dir.resolve("config.yaml.tmp")
        Files.writeString(tmp, body, StandardCharsets.UTF_8)
        try {
            Files.setPosixFilePermissions(tmp, PosixFilePermissions.fromString("rw-------"))
        } catch (_: UnsupportedOperationException) {
            // Windows
        }
        Files.move(
            tmp,
            configYamlPath(),
            StandardCopyOption.REPLACE_EXISTING,
            StandardCopyOption.ATOMIC_MOVE,
        )
    }

    private fun sha256Hex(bytes: ByteArray): String {
        val md = MessageDigest.getInstance("SHA-256")
        return md.digest(bytes).joinToString("") { "%02x".format(it) }
    }

    /**
     * Perform one sync pass. Safe to call from any thread — uses
     * the shared background HTTP client and never touches the EDT.
     */
    fun runSync(): SyncStatus {
        val authService = service<AiFirewallAuthService>()
        val state = authService.getState()
        if (!state.signedIn || state.token == null) {
            return SyncStatus.NotSignedIn
        }
        val proxyUrl = state.proxyUrl ?: "http://localhost:8080"
        val token = state.token!!

        if (isUserManaged()) {
            log.info("Assistant sync skipped — config.yaml is user-managed")
            return SyncStatus.UserManaged
        }

        val cachedEtag = readCachedEtag()
        val reqBuilder = HttpRequest.newBuilder()
            .uri(URI.create("${proxyUrl.trimEnd('/')}/api/me/assistant"))
            .header("Authorization", "Bearer $token")
            .GET()
        if (cachedEtag != null) {
            reqBuilder.header("If-None-Match", cachedEtag)
        }

        return try {
            val res = httpClient.send(reqBuilder.build(), HttpResponse.BodyHandlers.ofString())
            when (res.statusCode()) {
                304 -> SyncStatus.Ok(fresh = false)
                404 -> SyncStatus.Error(
                    "No assistant configured on the server. " +
                        "Open the web dashboard and add a model in Settings → Assistant.",
                )
                in 200..299 -> {
                    val body = gson.fromJson(res.body(), AssistantResponse::class.java)
                    val yaml = body.assistant.yaml
                    val etag = body.assistant.etag

                    // Skip the disk write if the YAML on disk is
                    // already byte-identical (modulo the managed
                    // header). Covers the case where the cache
                    // etag was deleted but the file is fine.
                    val freshHash = sha256Hex(yaml.toByteArray(StandardCharsets.UTF_8))
                    val currentHash = try {
                        val current = Files.readString(configYamlPath())
                        val withoutHeader = current.removePrefix(MANAGED_HEADER)
                        sha256Hex(withoutHeader.toByteArray(StandardCharsets.UTF_8))
                    } catch (_: Exception) {
                        ""
                    }

                    if (currentHash == freshHash && cachedEtag == etag) {
                        SyncStatus.Ok(fresh = false)
                    } else {
                        writeConfigYaml(yaml)
                        writeCachedEtag(etag)
                        SyncStatus.Ok(fresh = true)
                    }
                }
                else -> SyncStatus.Error("HTTP ${res.statusCode()}")
            }
        } catch (e: Exception) {
            log.info("Assistant sync error: ${e.message}")
            SyncStatus.Error(e.message ?: "unknown")
        }
    }

    /**
     * Schedule an out-of-band sync on the shared pool. Called
     * from `AiFirewallSignInAction` after a successful sign-in.
     */
    fun scheduleSync() {
        ApplicationManager.getApplication().executeOnPooledThread {
            runSync()
        }
    }
}
