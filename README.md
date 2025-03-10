# GPTme VS Code Extension

🚧 **Work in Progress** 🚧

VS Code extension for [GPTme](https://github.com/ErikBjare/gptme) - AI assistant in your editor.

## Current Status

This extension is currently under active development and is not yet available in the VS Code marketplace. To use it, you'll need to:
1. Install the latest gptme-server locally
2. Run the extension from source

## Features

- 💬 Chat interface in VS Code sidebar
- 🔧 Execute GPTme commands directly from VS Code
- 📁 Context-aware file operations
- 🎯 Quick access through status bar

## Requirements

- VS Code 1.85.0 or higher
- Latest gptme-server installed locally

## Installation

### 1. Install gptme-server

First, follow the installation instructions in the [gptme repository](https://github.com/ErikBjare/gptme) to install the latest version of gptme-server locally.

### 2. Run the Extension Locally

1. Clone this repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Open the project in VS Code

## Usage

### Starting a Chat

1. Click the GPTme icon in the activity bar (sidebar)
2. Type your message in the chat input
3. Press Enter or click Send

### Quick Commands

- `GPTme: Start Chat` - Open the chat interface
- `GPTme: Execute Command` - Execute a GPTme command
- `GPTme: Ask About This File` - Ask about the current file

## Development

This is an early development version. Features and functionality may change significantly.

### Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This extension is licensed under the ISC license.
