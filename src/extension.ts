import * as vscode from 'vscode';
import { ChatViewProvider } from './webview/chatView';
import { GptmeService } from './services/gptmeService';

export async function activate(context: vscode.ExtensionContext) {
    console.log('GPTme extension is now active');

    // Show immediate feedback
    vscode.window.showInformationMessage('GPTme is starting...');

    // Initialize the GptmeService with context
    const gptmeService = GptmeService.getInstance(context);
    
    // Show the GPTme view
    try {
        await vscode.commands.executeCommand('workbench.view.extension.gptme-sidebar');
        console.log('GPTme sidebar view activated');
        
        // Create status bar items
        const chatStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        chatStatusBarItem.text = "$(comment-discussion) GPTme";
        chatStatusBarItem.tooltip = "Click to open GPTme chat";
        chatStatusBarItem.command = 'workbench.view.extension.gptme-sidebar';
        chatStatusBarItem.show();
        
        const serverStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 101);
        serverStatusBarItem.text = "$(sync~spin) GPTme Server";
        serverStatusBarItem.tooltip = "Starting GPTme server...";
        serverStatusBarItem.command = 'gptme.restartServer';
        serverStatusBarItem.show();

        // Update server status
        const updateServerStatus = (status: 'starting' | 'running' | 'error') => {
            switch (status) {
                case 'starting':
                    serverStatusBarItem.text = "$(sync~spin) GPTme Server";
                    serverStatusBarItem.tooltip = "Starting GPTme server...";
                    break;
                case 'running':
                    serverStatusBarItem.text = "$(check) GPTme Server";
                    serverStatusBarItem.tooltip = "GPTme server is running. Click to restart.";
                    break;
                case 'error':
                    serverStatusBarItem.text = "$(error) GPTme Server";
                    serverStatusBarItem.tooltip = "GPTme server error. Click to restart.";
                    break;
            }
        };

        // Listen for server status changes
        gptmeService.onStatusChange(updateServerStatus);
        
        context.subscriptions.push(chatStatusBarItem, serverStatusBarItem);
    } catch (error) {
        console.error('Failed to show GPTme sidebar:', error);
        vscode.window.showErrorMessage('Failed to initialize GPTme: ' + (error instanceof Error ? error.message : String(error)));
    }

    // Register Chat View Provider
    const chatViewProvider = new ChatViewProvider(context.extensionUri);
    
    // Register commands
    const commands = [
        vscode.commands.registerCommand('gptme.test', async () => {
            try {
                const response = await gptmeService.sendMessage("Hello, are you working?");
                vscode.window.showInformationMessage('GPTme test successful!');
            } catch (error) {
                vscode.window.showErrorMessage('GPTme test failed: ' + (error instanceof Error ? error.message : String(error)));
            }
        }),
        
        vscode.commands.registerCommand('gptme.restartServer', async () => {
            try {
                vscode.window.showInformationMessage('Restarting GPTme server...');
                await gptmeService.restartServer();
                vscode.window.showInformationMessage('GPTme server restarted successfully');
            } catch (error) {
                vscode.window.showErrorMessage('Failed to restart server: ' + (error instanceof Error ? error.message : String(error)));
            }
        })
    ];

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('gptme.chatView', chatViewProvider),
        ...commands
    );

    // Clean up on deactivation
    context.subscriptions.push({
        dispose: () => {
            gptmeService.dispose();
        }
    });
}

export function deactivate() {
    // The cleanup will be handled by the subscription disposal
}
