package com.github.continuedev.continueintellijextension.security

import com.github.continuedev.continueintellijextension.Icons
import com.intellij.ide.projectView.PresentationData
import com.intellij.ide.projectView.ProjectViewNode
import com.intellij.ide.projectView.ProjectViewNodeDecorator
import com.intellij.openapi.components.service
import com.intellij.packageDependencies.ui.PackageDependenciesNode
import com.intellij.ui.SimpleTextAttributes

/**
 * Phase E — JetBrains file-scope UI.
 *
 * Implements ProjectViewNodeDecorator to add the security lock icon
 * and a "Restricted" suffix to files and folders blocked by the
 * AI Firewall policy in the Project view.
 */
class AiFirewallProjectViewDecorator : ProjectViewNodeDecorator {
    override fun decorate(node: ProjectViewNode<*>, data: PresentationData) {
        val file = node.virtualFile ?: return
        val project = node.project ?: return
        val fileScopeService = project.service<AiFirewallFileScopeService>()
        
        if (fileScopeService.isFileRestricted(file.path)) {
            data.addText(" [Restricted]", SimpleTextAttributes.GRAYED_ATTRIBUTES)
            data.setIcon(Icons.SecurityLock)
            data.tooltip = fileScopeService.getRestrictionReason(file.path) ?: "Restricted by AI Firewall policy"
        }
    }

    override fun decorate(node: PackageDependenciesNode, data: PresentationData) {}
}
