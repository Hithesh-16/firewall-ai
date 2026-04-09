package com.github.continuedev.continueintellijextension.auth

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.ui.Messages

/**
 * AI Firewall: Sign Out
 *
 * Confirms the intent, then runs the full three-step logout flow on a
 * background task: proxy token revoke → PasswordSafe clear → shared
 * auth file delete. Any individual step can fail without blocking
 * the others so the user always ends up in a clean local state.
 */
class AiFirewallSignOutAction : AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project

        val confirm = Messages.showYesNoDialog(
            project,
            "Sign out of AI Firewall? You'll need to sign in again to make LLM requests.",
            "AI Firewall",
            Messages.getQuestionIcon(),
        )
        if (confirm != Messages.YES) return

        ProgressManager.getInstance().run(
            object : Task.Backgroundable(project, "Signing out of AI Firewall…", false) {
                override fun run(indicator: ProgressIndicator) {
                    indicator.isIndeterminate = true
                    val service = service<AiFirewallAuthService>()
                    try {
                        service.signOut()
                        ApplicationManager.getApplication().invokeLater {
                            Messages.showInfoMessage(
                                project,
                                "Signed out of AI Firewall.",
                                "AI Firewall",
                            )
                        }
                    } catch (t: Throwable) {
                        // signOut() swallows everything it can, so
                        // this block is belt-and-braces in case
                        // something truly unexpected bubbles up.
                        val msg = t.message ?: t.javaClass.simpleName
                        ApplicationManager.getApplication().invokeLater {
                            Messages.showErrorDialog(
                                project,
                                "Sign-out error: $msg. Local state cleared anyway.",
                                "AI Firewall",
                            )
                        }
                    }
                }
            },
        )
    }
}
