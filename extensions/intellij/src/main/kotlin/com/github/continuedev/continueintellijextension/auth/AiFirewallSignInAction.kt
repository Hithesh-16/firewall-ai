package com.github.continuedev.continueintellijextension.auth

import com.github.continuedev.continueintellijextension.security.AiFirewallFileScopeService
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.ui.Messages

/**
 * AI Firewall: Sign In
 *
 * Runs the web-first loopback sign-in on a background task so the EDT
 * stays responsive while the browser is open. On success, shows a
 * notification with the signed-in email. On failure, shows a dialog
 * with the error message.
 *
 * Proxy URL defaults to `http://localhost:8080` and can be overridden
 * via the `AI_FIREWALL_PROXY_URL` env var. A future PR will add an
 * IDE setting in Settings → Tools → AI Firewall.
 */
class AiFirewallSignInAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project
        val proxyUrl = resolveProxyUrl()

        ProgressManager.getInstance().run(
            object : Task.Backgroundable(project, "Signing in to AI Firewall…", false) {
                override fun run(indicator: ProgressIndicator) {
                    indicator.isIndeterminate = true
                    indicator.text = "Opening browser — complete sign-in in the AI Firewall dashboard"

                    val service = service<AiFirewallAuthService>()
                    try {
                        val state = service.signInBlocking(proxyUrl)

                        // Phase E: refresh the file-scope cache now
                        // that we have a bearer token. Runs on the
                        // shared pool thread so the sign-in action
                        // returns immediately.
                        AiFirewallFileScopeService.scheduleRefresh()

                        val who = state.email ?: "AI Firewall"
                        ApplicationManager.getApplication().invokeLater {
                            Messages.showInfoMessage(
                                project,
                                "Signed in as $who.",
                                "AI Firewall",
                            )
                        }
                    } catch (t: Throwable) {
                        val msg = t.message ?: t.javaClass.simpleName
                        ApplicationManager.getApplication().invokeLater {
                            Messages.showErrorDialog(
                                project,
                                "Sign-in failed: $msg",
                                "AI Firewall",
                            )
                        }
                    }
                }
            },
        )
    }

    private fun resolveProxyUrl(): String {
        val fromEnv = System.getenv("AI_FIREWALL_PROXY_URL")
        if (!fromEnv.isNullOrBlank()) return fromEnv.trimEnd('/')

        // Reuse any proxy URL the user previously signed in against.
        val cached = service<AiFirewallAuthService>().getState().proxyUrl
        if (!cached.isNullOrBlank()) return cached.trimEnd('/')

        return "http://localhost:8080"
    }
}
