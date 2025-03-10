import * as vscode from "vscode";
import { GptmeService } from "../services/gptmeService";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;
  private _gptmeService: GptmeService;
  private _isLoading = false;

  constructor(private readonly _extensionUri: vscode.Uri) {
    this._gptmeService = GptmeService.getInstance();

    // Listen for server status changes
    this._gptmeService.onStatusChange((status) => {
      if (this._view) {
        this._view.webview.postMessage({
          type: "serverStatus",
          status,
        });
      }
    });
  }

  private async setLoading(loading: boolean) {
    this._isLoading = loading;
    if (this._view) {
      await this._view.webview.postMessage({
        type: "loading",
        value: loading,
      });
    }
  }

  public async resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;
    this._gptmeService.setWebview(webviewView);

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, "media")],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Start a new conversation
    try {
      await this.setLoading(true);
      const conversationId = new Date().toISOString().replace(/[:.]/g, "-");
      await this._gptmeService.createConversation(conversationId);
      console.log("Started new conversation:", conversationId);

      if (this._view) {
        await this._view.webview.postMessage({
          type: "status",
          message: "Ready for conversation",
        });
      }
    } catch (error) {
      console.error("Failed to start conversation:", error);
      if (this._view) {
        await this._view.webview.postMessage({
          type: "error",
          message:
            "Failed to start conversation: " +
            (error instanceof Error ? error.message : String(error)),
        });
      }
    } finally {
      await this.setLoading(false);
    }

    webviewView.webview.onDidReceiveMessage(async (data) => {
      if (data.type === "sendMessage") {
        await this.setLoading(true);

        try {
          await this._gptmeService.sendMessage(data.message);
          // Don't send another message here - GptmeService handles the final response
        } catch (error) {
          console.error("Error in message handler:", error);
          await this._view?.webview.postMessage({
            type: "error",
            message:
              error instanceof Error ? error.message : "An error occurred",
          });
        } finally {
          await this.setLoading(false);
        }
      }
    });
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, "media", "main.js")
    );

    return `<!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>GPTme Chat</title>
            
            <!-- Add Markdown and Syntax Highlighting -->
            <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/highlight.min.js"></script>
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.8.0/styles/vs2015.min.css">
            
            <style>
              body {
                padding: 0;
                margin: 0;
                width: 100%;
                height: 100vh;
                overflow: hidden;
                background-color: var(--vscode-editor-background);
                color: var(--vscode-editor-foreground);
              }
              
              #messages {
                height: calc(100vh - 80px);
                overflow-y: auto;
                padding: 20px;
              }
              
              .message {
                margin-bottom: 20px;
                padding: 10px;
                border-radius: 5px;
              }
              
              .user-message {
                background-color: var(--vscode-editor-lineHighlightBackground);
              }
              
              .assistant-message {
                background-color: var(--vscode-editor-selectionBackground);
              }
              
              .error-message {
                background-color: var(--vscode-errorForeground);
                color: var(--vscode-editor-background);
              }
              
              .message-time {
                font-size: 10px;
                opacity: 0.7;
                margin-top: 5px;
              }
              
              .input-container {
                position: fixed;
                bottom: 0;
                left: 0;
                right: 0;
                padding: 10px;
                background-color: var(--vscode-editor-background);
                display: flex;
                gap: 10px;
              }
              
              #messageInput {
                flex-grow: 1;
                padding: 8px;
                border: 1px solid var(--vscode-input-border);
                background-color: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border-radius: 4px;
              }
              
              button {
                padding: 8px 16px;
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                border-radius: 4px;
                cursor: pointer;
              }
              
              button:hover {
                background-color: var(--vscode-button-hoverBackground);
              }
              
              button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
              }

              /* Code block styling */
              pre {
                background-color: var(--vscode-editor-background);
                border: 1px solid var(--vscode-editor-lineHighlightBorder);
                border-radius: 4px;
                padding: 1em;
                overflow-x: auto;
                margin: 1em 0;
              }

              code {
                font-family: var(--vscode-editor-font-family, "Consolas, 'Courier New', monospace");
                font-size: var(--vscode-editor-font-size, 14px);
              }

              .hljs {
                background: transparent;
                padding: 0;
              }
            </style>
          </head>
          <body>
            <div id="messages"></div>
            <div class="input-container">
              <input type="text" id="messageInput" placeholder="Type a message..." />
              <button id="sendButton">Send</button>
            </div>
            <script src="${scriptUri}"></script>
          </body>
        </html>`;
  }
}
