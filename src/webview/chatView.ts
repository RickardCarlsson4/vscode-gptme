import * as vscode from 'vscode';
import { GptmeService } from '../services/gptmeService';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    private _view?: vscode.WebviewView;
    private _gptmeService: GptmeService;
    private _isLoading = false;

    constructor(
        private readonly _extensionUri: vscode.Uri,
    ) {
        this._gptmeService = GptmeService.getInstance();
        
        // Listen for server status changes
        this._gptmeService.onStatusChange(status => {
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'serverStatus',
                    status
                });
            }
        });
    }

    private async setLoading(loading: boolean) {
        this._isLoading = loading;
        if (this._view) {
            await this._view.webview.postMessage({
                type: 'loading',
                value: loading
            });
        }
    }

    public async resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        this._gptmeService.setWebview(webviewView);

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this._extensionUri, 'media')
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Start a new conversation
        try {
            await this.setLoading(true);
            const conversationId = new Date().toISOString().replace(/[:.]/g, '-');
            await this._gptmeService.createConversation(conversationId);
            console.log('Started new conversation:', conversationId);
            
            if (this._view) {
                await this._view.webview.postMessage({
                    type: 'status',
                    message: 'Ready for conversation'
                });
            }
        } catch (error) {
            console.error('Failed to start conversation:', error);
            if (this._view) {
                await this._view.webview.postMessage({
                    type: 'error',
                    message: 'Failed to start conversation: ' + (error instanceof Error ? error.message : String(error))
                });
            }
        } finally {
            await this.setLoading(false);
        }

        webviewView.webview.onDidReceiveMessage(async (data) => {
            if (data.type === 'sendMessage') {
                await this.setLoading(true);

                try {
                    await this._gptmeService.sendMessage(data.message);
                    // Don't send another message here - GptmeService handles the final response
                } catch (error) {
                    console.error('Error in message handler:', error);
                    await this._view?.webview.postMessage({ 
                        type: 'error', 
                        message: error instanceof Error ? error.message : 'An error occurred' 
                    });
                } finally {
                    await this.setLoading(false);
                }
            }
        });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js')
        );

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src ${webview.cspSource};">
                <title>GPTme Chat</title>
                <style>
                    body {
                        padding: 0;
                        margin: 0;
                        font-family: var(--vscode-font-family);
                    }
                    .chat-container {
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                        background: var(--vscode-editor-background);
                    }
                    .messages {
                        flex: 1;
                        overflow-y: auto;
                        padding: 16px;
                        display: flex;
                        flex-direction: column;
                        gap: 8px;
                    }
                    .message {
                        padding: 8px 12px;
                        border-radius: 6px;
                        max-width: 85%;
                        word-wrap: break-word;
                        font-size: 13px;
                        line-height: 1.4;
                        margin: 4px 0;
                    }
                    .user-message {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        margin-left: auto;
                        border-top-right-radius: 2px;
                        font-weight: 500;
                    }
                    .assistant-message {
                        background-color: var(--vscode-editor-inactiveSelectionBackground);
                        margin-right: auto;
                        border-top-left-radius: 2px;
                        border-left: 3px solid var(--vscode-activityBar-activeBorder);
                    }
                    .messages {
                        padding: 20px !important;
                        gap: 12px !important;
                    }
                    .error-message {
                        background-color: var(--vscode-inputValidation-errorBackground);
                        color: var(--vscode-inputValidation-errorForeground);
                        border: 1px solid var(--vscode-inputValidation-errorBorder);
                        margin-right: auto;
                        border-top-left-radius: 2px;
                    }
                    .message-time {
                        font-size: 10px;
                        opacity: 0.7;
                        margin-top: 4px;
                        text-align: right;
                    }
                    .assistant-message .message-time {
                        text-align: left;
                    }
                    #stream-message {
                        border-left: 3px solid var(--vscode-progressBar-background) !important;
                        animation: pulse 2s infinite;
                    }
                    @keyframes pulse {
                        0% { opacity: 1; }
                        50% { opacity: 0.7; }
                        100% { opacity: 1; }
                    }
                    .status-bar {
                        padding: 4px 16px;
                        font-size: 12px;
                        border-bottom: 1px solid var(--vscode-panel-border);
                        display: flex;
                        align-items: center;
                        gap: 8px;
                    }
                    .status-indicator {
                        width: 8px;
                        height: 8px;
                        border-radius: 50%;
                        background-color: var(--vscode-inputValidation-errorBackground);
                    }
                    .status-indicator.connected {
                        background-color: var(--vscode-testing-iconPassed);
                    }
                    .input-container {
                        padding: 16px;
                        display: flex;
                        gap: 8px;
                        background: var(--vscode-editor-background);
                        border-top: 1px solid var(--vscode-panel-border);
                    }
                    #messageInput {
                        flex: 1;
                        padding: 8px 12px;
                        border: 1px solid var(--vscode-input-border);
                        background: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border-radius: 4px;
                        font-family: inherit;
                        font-size: 13px;
                    }
                    #messageInput:focus {
                        outline: none;
                        border-color: var(--vscode-focusBorder);
                    }
                    button {
                        padding: 8px 16px;
                        background: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        border-radius: 4px;
                        cursor: pointer;
                        font-size: 13px;
                        min-width: 60px;
                        display: inline-flex;
                        align-items: center;
                        justify-content: center;
                    }
                    button:hover {
                        background: var(--vscode-button-hoverBackground);
                    }
                    button:disabled {
                        opacity: 0.5;
                        cursor: not-allowed;
                    }
                </style>
            </head>
            <body>
                <div class="chat-container">
                    <div class="status-bar">
                        <div class="status-indicator" id="connectionStatus"></div>
                        <span id="statusText">Connecting to GPTme server...</span>
                    </div>
                    <div class="messages" id="messages">
                        <div class="message assistant-message" style="opacity: 0.8;">
                            Welcome to GPTme! I'm here to help you with:
                            • Writing and reviewing code
                            • Answering questions
                            • Providing explanations
                            • Running commands
                            
                            Your messages will be part of the same conversation until you close the window.
                            Type your message and press Enter to start!
                        </div>
                    </div>
                    <div class="input-container">
                        <input type="text" id="messageInput" placeholder="Type your message... (Enter to send)">
                        <button id="sendButton">Send</button>
                    </div>
                </div>
                <script src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }
}
