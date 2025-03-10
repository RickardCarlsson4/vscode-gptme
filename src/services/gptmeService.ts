import * as vscode from "vscode";
import { spawn, ChildProcess } from "child_process";
import fetch from "node-fetch";
import { ReadableStream } from "node:stream/web";

interface Message {
  role: string;
  content: string;
  timestamp?: string;
  stored?: boolean;
}

interface Conversation {
  id: string;
  messages: Message[];
}

interface ServerResponse {
  role: string;
  content: string;
  stored?: boolean;
  error?: string;
}

export class GptmeService {
  private static instance: GptmeService;
  private baseUrl = "http://localhost:5000";
  private currentConversation: string | null = null;
  private _view: vscode.WebviewView | undefined;
  private serverProcess: ChildProcess | null = null;
  private outputChannel: vscode.OutputChannel;
  private statusEmitter = new vscode.EventEmitter<
    "starting" | "running" | "error"
  >();
  public readonly onStatusChange = this.statusEmitter.event;
  private readonly extensionContext: vscode.ExtensionContext;
  private workspaceFolder?: string;

  private constructor(context: vscode.ExtensionContext) {
    this.extensionContext = context;
    this.outputChannel = vscode.window.createOutputChannel("GPTme Server");

    this.outputChannel.appendLine("Initializing GPTme Service...");

    // Register for cleanup
    this.extensionContext.subscriptions.push(this.outputChannel);
    this.extensionContext.subscriptions.push(this.statusEmitter);

    // Initialize workspace folder
    this.updateWorkspaceFolder();

    // Listen for workspace folder changes
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      this.updateWorkspaceFolder();
    });
  }

  public static getInstance(context?: vscode.ExtensionContext): GptmeService {
    if (!GptmeService.instance) {
      if (!context) {
        throw new Error("GptmeService must be initialized with a context");
      }
      GptmeService.instance = new GptmeService(context);
    }
    return GptmeService.instance;
  }

  private updateStatus(status: "starting" | "running" | "error"): void {
    console.log("Server status:", status);
    this.statusEmitter.fire(status);
  }

  private async updateWorkspaceFolder(): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    this.outputChannel.appendLine("Workspace change detected...");

    if (workspaceFolders && workspaceFolders.length > 0) {
      const newWorkspace = workspaceFolders[0].uri.fsPath;
      this.outputChannel.appendLine(`Found workspace: ${newWorkspace}`);

      if (this.workspaceFolder !== newWorkspace) {
        this.outputChannel.appendLine(
          `Workspace changed from ${
            this.workspaceFolder || "none"
          } to ${newWorkspace}`
        );
        this.workspaceFolder = newWorkspace;

        // If server is running, restart it in new workspace
        if (this.serverProcess) {
          this.outputChannel.appendLine(
            "Restarting server for new workspace..."
          );
          try {
            await this.restartServer();
          } catch (error) {
            this.outputChannel.appendLine(`Failed to restart server: ${error}`);
            vscode.window.showErrorMessage(
              `Failed to initialize GPTme in new workspace: ${error}`
            );
          }
        }
      } else {
        this.outputChannel.appendLine("Workspace unchanged");
      }
    } else {
      const homeDir = process.env.HOME || process.env.USERPROFILE;
      const fallbackDir = homeDir || require("os").tmpdir();
      this.outputChannel.appendLine(
        `No workspace folder, using fallback: ${fallbackDir}`
      );

      if (this.workspaceFolder) {
        this.outputChannel.appendLine(
          "Workspace was removed, reverting to fallback directory"
        );
        this.workspaceFolder = undefined;

        if (this.serverProcess) {
          this.outputChannel.appendLine(
            "Restarting server in fallback location..."
          );
          try {
            await this.restartServer();
          } catch (error) {
            this.outputChannel.appendLine(`Failed to restart server: ${error}`);
          }
        }
      }
    }
  }

  private async ensureServerRunning(): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/conversations`);
      if (response.ok) {
        console.log("Found existing server running");
        this.updateStatus("running");
        return;
      }
    } catch (error) {
      console.log("No existing server found, will start new one");
    }

    // Update workspace folder before starting server
    await this.updateWorkspaceFolder();

    // Use workspace folder or fallback to current directory
    const workingDir = this.workspaceFolder || process.cwd();
    this.outputChannel.appendLine(`Using working directory: ${workingDir}`);

    // Server options
    const serverOptions = {
      shell: true,
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1", // Ensure Python output is not buffered
      },
      cwd: workingDir,
    };

    console.log("Starting GPTme server...");
    this.outputChannel.show();
    this.updateStatus("starting");

    // Start the server using child_process with workspace argument
    this.serverProcess = spawn(
      "gptme-server",
      ["--verbose", "--workspace", workingDir],
      serverOptions
    );

    if (this.serverProcess.stdout) {
      this.serverProcess.stdout.on("data", (data: Buffer) => {
        const output = data.toString();
        console.log("Server stdout:", output);
        this.outputChannel.appendLine(output);
      });
    }

    if (this.serverProcess.stderr) {
      this.serverProcess.stderr.on("data", (data: Buffer) => {
        const output = data.toString();
        console.error("Server stderr:", output);
        this.outputChannel.appendLine(`[ERROR] ${output}`);
      });
    }

    this.serverProcess.on("error", (error: Error) => {
      console.error("Server process error:", error);
      this.outputChannel.appendLine(`Server process error: ${error.message}`);
      this.updateStatus("error");
      this.serverProcess = null;
    });

    // Wait for server to start
    for (let i = 0; i < 20; i++) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        console.log(`Attempt ${i + 1}: Checking if server is running...`);
        const response = await fetch(`${this.baseUrl}/api/conversations`);
        if (response.ok) {
          console.log("GPTme server started successfully");
          this.updateStatus("running");
          return;
        }
        console.log(`Server not ready yet (status: ${response.status})`);
      } catch (error) {
        console.log(
          `Attempt ${i + 1} failed:`,
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    const errorMsg = "Failed to start GPTme server after multiple attempts";
    this.updateStatus("error");
    throw new Error(errorMsg);
  }

  public async createConversation(id: string): Promise<void> {
    await this.ensureServerRunning();

    console.log("Creating new conversation:", id);
    const createResponse = await fetch(
      `${this.baseUrl}/api/conversations/${id}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify([]),
      }
    );

    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      console.error("Failed to create conversation:", errorText);
      throw new Error(
        `Failed to create conversation: ${createResponse.status} ${errorText}`
      );
    }

    this.currentConversation = id;
    console.log("New conversation created successfully");
  }

  public async sendMessage(message: string): Promise<string> {
    await this.ensureServerRunning();

    if (!this.currentConversation) {
      const id = new Date().toISOString().replace(/[:.]/g, "-");
      await this.createConversation(id);
    }

    // Add the user message
    const messageResponse = await fetch(
      `${this.baseUrl}/api/conversations/${this.currentConversation}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          role: "user",
          content: message,
          branch: "main",
        }),
      }
    );

    if (!messageResponse.ok) {
      const errorText = await messageResponse.text();
      throw new Error(
        `Failed to add message: ${messageResponse.status} ${errorText}`
      );
    }

    return new Promise<string>(async (resolve, reject) => {
      try {
        const generateUrl = `${this.baseUrl}/api/conversations/${this.currentConversation}/generate`;
        console.log("Connecting to generate endpoint:", generateUrl);

        const response = await fetch(generateUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "text/event-stream",
          },
          body: JSON.stringify({
            stream: true,
            branch: "main",
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Generate failed: ${response.status} ${errorText}`);
        }

        if (!response.body) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let fullResponse = "";

        try {
          // Handle Node.js readable stream
          for await (const chunk of response.body) {
            const text = decoder.decode(chunk as Buffer, { stream: true });
            const lines = text.split("\n");

            for (const line of lines) {
              if (line.startsWith("data: ")) {
                const data = line.slice(6);
                try {
                  console.log("Processing SSE data:", data);
                  const parsed = JSON.parse(data) as ServerResponse;

                  if (parsed.error) {
                    throw new Error(parsed.error);
                  }

                  switch (parsed.role) {
                    case "assistant":
                      if (parsed.stored) {
                        console.log("Final response:", parsed.content);
                        fullResponse = parsed.content;
                        if (this._view) {
                          this._view.webview.postMessage({
                            type: "response",
                            message: parsed.content,
                            role: "assistant",
                          });
                        }
                      } else {
                        if (this._view) {
                          this._view.webview.postMessage({
                            type: "stream",
                            content: parsed.content,
                          });
                        }
                      }
                      break;

                    case "system":
                    case "tool":
                      console.log(`${parsed.role} message:`, parsed.content);
                      if (this._view) {
                        this._view.webview.postMessage({
                          type: "response",
                          message: parsed.content,
                          role: parsed.role,
                        });
                      }
                      break;
                  }
                } catch (parseError) {
                  console.error("Parse error:", parseError, "Raw data:", data);
                  throw parseError;
                }
              }
            }
          }

          resolve(fullResponse);
        } catch (error) {
          reject(error);
        }
      } catch (error) {
        reject(error);
      }
    });
  }

  public async restartServer(): Promise<void> {
    this.outputChannel.appendLine("Restarting GPTme server...");

    // Kill existing server if running
    if (this.serverProcess) {
      console.log("Stopping GPTme server...");
      this.serverProcess.kill();
      this.serverProcess = null;
    }

    // Wait for the server to fully stop
    await new Promise((resolve) => setTimeout(resolve, 1000));

    try {
      // Update status
      this.updateStatus("starting");

      // Start the server again
      await this.ensureServerRunning();

      this.outputChannel.appendLine("Server restarted successfully");
      vscode.window.showInformationMessage(
        "GPTme server restarted successfully"
      );
    } catch (error) {
      const errorMessage = `Failed to restart server: ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.outputChannel.appendLine(errorMessage);
      vscode.window.showErrorMessage(errorMessage);
      throw error;
    }
  }

  public setWebview(view: vscode.WebviewView): void {
    this._view = view;
  }

  public dispose(): void {
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }
    if (this.outputChannel) {
      this.outputChannel.dispose();
    }
    this.statusEmitter.dispose();
  }
}
