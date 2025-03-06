import * as vscode from 'vscode';
import { spawn, ChildProcess } from 'child_process';
import fetch from 'node-fetch';

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
    private baseUrl = 'http://localhost:5000';
    private currentConversation: string | null = null;
    private _view: vscode.WebviewView | undefined;
    private serverProcess: ChildProcess | null = null;
    private outputChannel: vscode.OutputChannel;
    private statusEmitter = new vscode.EventEmitter<'starting' | 'running' | 'error'>();
    public readonly onStatusChange = this.statusEmitter.event;

    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('GPTme Server');
    }

    public static getInstance(): GptmeService {
        if (!GptmeService.instance) {
            GptmeService.instance = new GptmeService();
        }
        return GptmeService.instance;
    }

    private updateStatus(status: 'starting' | 'running' | 'error'): void {
        console.log('Server status:', status);
        this.statusEmitter.fire(status);
    }

    private async ensureServerRunning(): Promise<void> {
        try {
            const response = await fetch(`${this.baseUrl}/api/conversations`);
            if (response.ok) {
                console.log('Found existing server running');
                this.updateStatus('running');
                return;
            }
        } catch (error) {
            console.log('No existing server found, will start new one');
        }

        console.log('Starting GPTme server...');
        this.outputChannel.show();
        this.updateStatus('starting');
        
        // Start the server using child_process
        this.serverProcess = spawn('gptme-server', [], {
            shell: true,
            env: {
                ...process.env,
                PYTHONUNBUFFERED: '1'  // Ensure Python output is not buffered
            }
        });

        if (this.serverProcess.stdout) {
            this.serverProcess.stdout.on('data', (data: Buffer) => {
                const output = data.toString();
                console.log('Server stdout:', output);
                this.outputChannel.appendLine(output);
            });
        }

        if (this.serverProcess.stderr) {
            this.serverProcess.stderr.on('data', (data: Buffer) => {
                const output = data.toString();
                console.error('Server stderr:', output);
                this.outputChannel.appendLine(`[ERROR] ${output}`);
            });
        }

        this.serverProcess.on('error', (error: Error) => {
            console.error('Server process error:', error);
            this.outputChannel.appendLine(`Server process error: ${error.message}`);
            this.updateStatus('error');
            this.serverProcess = null;
        });

        // Wait for server to start
        for (let i = 0; i < 20; i++) {
            try {
                await new Promise(resolve => setTimeout(resolve, 1000));
                console.log(`Attempt ${i + 1}: Checking if server is running...`);
                const response = await fetch(`${this.baseUrl}/api/conversations`);
                if (response.ok) {
                    console.log('GPTme server started successfully');
                    this.updateStatus('running');
                    return;
                }
                console.log(`Server not ready yet (status: ${response.status})`);
            } catch (error) {
                console.log(`Attempt ${i + 1} failed:`, error instanceof Error ? error.message : String(error));
            }
        }

        const errorMsg = 'Failed to start GPTme server after multiple attempts';
        this.updateStatus('error');
        throw new Error(errorMsg);
    }

    public async createConversation(id: string): Promise<void> {
        await this.ensureServerRunning();
        
        console.log('Creating new conversation:', id);
        const timestamp = new Date().toISOString();
        const createResponse = await fetch(`${this.baseUrl}/api/conversations/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                messages: [{
                    role: 'system',
                    content: 'VS Code GPTme Extension - New conversation started',
                    timestamp: timestamp
                }]
            })
        });
        
        if (!createResponse.ok) {
            const errorText = await createResponse.text();
            console.error('Failed to create conversation:', errorText);
            throw new Error(`Failed to create conversation: ${createResponse.status} ${errorText}`);
        }
        
        this.currentConversation = id;
        console.log('New conversation created successfully');
    }

    public async sendMessage(message: string): Promise<string> {
        await this.ensureServerRunning();

        if (!this.currentConversation) {
            throw new Error('No active conversation');
        }

        // Add the user message
        const messageResponse = await fetch(`${this.baseUrl}/api/conversations/${this.currentConversation}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                role: 'user',
                content: message,
                timestamp: new Date().toISOString()
            })
        });

        if (!messageResponse.ok) {
            const errorText = await messageResponse.text();
            throw new Error(`Failed to add message: ${messageResponse.status} ${errorText}`);
        }

        return new Promise<string>(async (resolve, reject) => {
            try {
                const generateUrl = `${this.baseUrl}/api/conversations/${this.currentConversation}/generate`;
                console.log('Connecting to generate endpoint:', generateUrl);

                const response = await fetch(generateUrl, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'text/event-stream',
                    },
                    body: JSON.stringify({
                        stream: true,
                        branch: 'main',
                        tools: null
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Generate failed: ${response.status} ${errorText}`);
                }

                if (!response.body) {
                    throw new Error('No response body');
                }

                const decoder = new TextDecoder();
                let fullResponse = '';
                let buffer = '';

                try {
                    // Handle Node.js readable stream
                    for await (const chunk of response.body) {
                        const text = decoder.decode(chunk as Buffer, { stream: true });
                        buffer += text;
                        
                        // Process complete lines from the buffer
                        let newlineIndex;
                        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
                            const line = buffer.slice(0, newlineIndex);
                            buffer = buffer.slice(newlineIndex + 1);

                            if (!line) continue;

                            if (line.startsWith('data: ')) {
                                const data = line.slice(6);
                                try {
                                    const parsed = JSON.parse(data) as ServerResponse;
                                    if (parsed.error) {
                                        throw new Error(parsed.error);
                                    }

                                    switch (parsed.role) {
                                        case 'assistant':
                                            if (parsed.stored) {
                                                // This is the complete message, replace any streaming content
                                                fullResponse = parsed.content;
                                                if (this._view) {
                                                    // Remove any existing stream message and show final
                                                    this._view.webview.postMessage({
                                                        type: 'finalResponse',
                                                        content: parsed.content
                                                    });
                                                }
                                            } else {
                                                // This is a streaming chunk
                                                if (this._view) {
                                                    this._view.webview.postMessage({
                                                        type: 'stream',
                                                        content: parsed.content
                                                    });
                                                }
                                            }
                                            break;

                                        case 'system':
                                        case 'tool':
                                            if (this._view) {
                                                this._view.webview.postMessage({
                                                    type: 'response',
                                                    message: parsed.content,
                                                    role: parsed.role
                                                });
                                            }
                                            break;
                                    }
                                } catch (error) {
                                    console.error('Parse error:', error, 'Raw data:', data);
                                    throw error;
                                }
                            }
                        }
                    }

                    // Only send streamEnd to finalize the streaming message
                    if (this._view) {
                        this._view.webview.postMessage({
                            type: 'streamEnd'
                        });
                    }

                    console.log('Stream completed');
                    resolve(fullResponse);
                } catch (error) {
                    reject(error);
                }
            } catch (error) {
                reject(error);
            }
        });
    }

    public setWebview(view: vscode.WebviewView): void {
        this._view = view;
    }

    public async restartServer(): Promise<void> {
        if (this.serverProcess) {
            console.log('Stopping GPTme server...');
            this.serverProcess.kill();
            this.serverProcess = null;
        }

        // Wait a bit for the server to fully stop
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Start the server again
        await this.ensureServerRunning();
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
