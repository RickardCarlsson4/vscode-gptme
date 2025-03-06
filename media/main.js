(function () {
    const vscode = acquireVsCodeApi();
    const messagesContainer = document.getElementById('messages');
    const messageInput = document.getElementById('messageInput');
    const sendButton = document.getElementById('sendButton');
    const connectionStatus = document.getElementById('connectionStatus');
    const statusText = document.getElementById('statusText');

    function updateConnectionStatus(isConnected, message) {
        connectionStatus.classList.toggle('connected', isConnected);
        statusText.textContent = message;
        messageInput.disabled = !isConnected;
        sendButton.disabled = !isConnected;
    }

    function addMessage(message, isUser, type = 'normal') {
        console.log('Adding message:', { message, isUser, type });
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${isUser ? 'user-message' : 'assistant-message'}`;
        
        // Add role indicator
        const roleIndicator = document.createElement('div');
        roleIndicator.style.fontSize = '11px';
        roleIndicator.style.marginBottom = '4px';
        roleIndicator.style.opacity = '0.7';
        roleIndicator.textContent = isUser ? 'You' : 'Assistant';
        messageDiv.appendChild(roleIndicator);
        
        if (type === 'error') {
            messageDiv.className = 'message error-message';
            // Add an error icon
            const errorIcon = document.createElement('span');
            errorIcon.textContent = '⚠️ ';
            errorIcon.style.marginRight = '4px';
            messageDiv.appendChild(errorIcon);
        }
        
        // Handle message text
        const textContent = document.createElement('div');
        textContent.style.whiteSpace = 'pre-wrap';  // Preserve line breaks
        textContent.textContent = type === 'error' ? `Error: ${message}` : message;
        messageDiv.appendChild(textContent);

        // Add timestamp
        const timeDiv = document.createElement('div');
        timeDiv.className = 'message-time';
        timeDiv.textContent = new Date().toLocaleTimeString();
        messageDiv.appendChild(timeDiv);
        
        // Add retry button for errors
        if (type === 'error') {
            const retryButton = document.createElement('button');
            retryButton.textContent = 'Retry Last Message';
            retryButton.style.marginTop = '8px';
            retryButton.style.fontSize = '12px';
            retryButton.style.padding = '4px 8px';
            retryButton.onclick = () => {
                const lastUserMessage = Array.from(messagesContainer.children)
                    .reverse()
                    .find(el => el.classList.contains('user-message'));
                
                if (lastUserMessage) {
                    const message = lastUserMessage.textContent;
                    vscode.postMessage({
                        type: 'sendMessage',
                        message: message
                    });
                }
            };
            messageDiv.appendChild(retryButton);
        }
        
        messagesContainer.appendChild(messageDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function setLoading(isLoading) {
        console.log('Setting loading state:', isLoading);
        
        sendButton.disabled = isLoading;
        messageInput.disabled = isLoading;
        
        if (isLoading) {
            sendButton.innerHTML = '<span style="display: inline-block; animation: spin 1s linear infinite;">⟳</span>';
            const loadingDiv = document.createElement('div');
            loadingDiv.className = 'message assistant-message';
            loadingDiv.id = 'loading-message';
            loadingDiv.innerHTML = 'GPTme is thinking<span class="dots">...</span>';
            
            // Animate the dots
            const style = document.createElement('style');
            style.textContent = `
                @keyframes dots { 
                    0% { content: '.'; }
                    33% { content: '..'; }
                    66% { content: '...'; }
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .dots { animation: dots 1.5s infinite; }
            `;
            document.head.appendChild(style);
            
            messagesContainer.appendChild(loadingDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        } else {
            sendButton.textContent = 'Send';
            const loadingDiv = document.getElementById('loading-message');
            if (loadingDiv) {
                loadingDiv.remove();
            }
        }
    }

    function handleSendMessage() {
        const message = messageInput.value.trim();
        if (message) {
            console.log('Sending message:', message);
            addMessage(message, true);
            vscode.postMessage({
                type: 'sendMessage',
                message: message
            });
            messageInput.value = '';
        }
    }

    // Send message on button click
    sendButton.addEventListener('click', handleSendMessage);

    // Send message on Enter
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    // Handle messages from the extension
    window.addEventListener('message', event => {
        const message = event.data;
        console.log('Received message from extension:', message);
        
        switch (message.type) {
            case 'clearMessages':
                // Clear all messages except the welcome message
                const welcomeMessage = messagesContainer.firstElementChild;
                messagesContainer.innerHTML = '';
                if (welcomeMessage) {
                    messagesContainer.appendChild(welcomeMessage);
                }
                break;

            case 'historicalMessage':
                // Add historical message without animation
                addMessage(message.content, message.role === 'user', 'historical');
                break;

            case 'response':
                // Only for non-assistant messages (system, tool)
                if (message.role !== 'assistant') {
                    addMessage(message.message, false);
                }
                break;

            case 'error':
                console.error('Error from extension:', message.message);
                addMessage(message.message, false, 'error');
                break;

            case 'status':
                updateStatus(message.message);
                break;

            case 'serverStatus':
                handleServerStatus(message.status);
                break;

            case 'loading':
                setLoading(message.value);
                break;

            case 'stream':
                handleStreamMessage(message.content);
                break;

            case 'finalResponse':
                // Remove any existing stream message
                const streamDiv = document.getElementById('stream-message');
                if (streamDiv) {
                    streamDiv.remove();
                }

                // Create final message
                const div = document.createElement('div');
                div.className = 'message assistant-message';
                
                // Add role indicator
                const roleIndicator = document.createElement('div');
                roleIndicator.style.fontSize = '11px';
                roleIndicator.style.marginBottom = '4px';
                roleIndicator.style.opacity = '0.7';
                roleIndicator.textContent = 'Assistant';
                div.appendChild(roleIndicator);

                // Add content container
                const contentDiv = document.createElement('div');
                contentDiv.style.whiteSpace = 'pre-wrap';
                contentDiv.textContent = message.content;
                div.appendChild(contentDiv);

                // Add timestamp
                const timeDiv = document.createElement('div');
                timeDiv.className = 'message-time';
                timeDiv.textContent = new Date().toLocaleTimeString();
                div.appendChild(timeDiv);

                messagesContainer.appendChild(div);
                messagesContainer.scrollTop = messagesContainer.scrollHeight;
                break;
        }
    });

    function handleServerStatus(status) {
        const statusIndicator = document.getElementById('connectionStatus');
        const statusText = document.getElementById('statusText');
        
        switch (status) {
            case 'starting':
                statusIndicator.className = 'status-indicator';
                statusIndicator.style.backgroundColor = 'var(--vscode-notificationsWarningIcon-foreground)';
                statusText.textContent = 'Starting GPTme server...';
                break;
            case 'running':
                statusIndicator.className = 'status-indicator connected';
                statusText.textContent = 'Connected to GPTme server';
                break;
            case 'error':
                statusIndicator.className = 'status-indicator';
                statusIndicator.style.backgroundColor = 'var(--vscode-notificationsErrorIcon-foreground)';
                statusText.textContent = 'Server error - click to restart';
                break;
        }
    }

    function updateStatus(message) {
        const statusDiv = document.createElement('div');
        statusDiv.className = 'message system-message';
        statusDiv.style.opacity = '0.6';
        statusDiv.style.textAlign = 'center';
        statusDiv.style.background = 'var(--vscode-editor-background)';
        statusDiv.style.margin = '8px 0';
        statusDiv.textContent = message;
        messagesContainer.appendChild(statusDiv);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function handleStreamMessage(content) {
        const streamDiv = document.getElementById('stream-message');
        if (!streamDiv) {
            const div = document.createElement('div');
            div.id = 'stream-message';
            div.className = 'message assistant-message';
            
            // Add role indicator
            const roleIndicator = document.createElement('div');
            roleIndicator.style.fontSize = '11px';
            roleIndicator.style.marginBottom = '4px';
            roleIndicator.style.opacity = '0.7';
            roleIndicator.textContent = 'Assistant';
            div.appendChild(roleIndicator);

            // Add content container
            const contentDiv = document.createElement('div');
            contentDiv.style.whiteSpace = 'pre-wrap';
            contentDiv.textContent = content;
            div.appendChild(contentDiv);

            messagesContainer.appendChild(div);
        } else {
            // Update existing stream message
            const contentDiv = streamDiv.querySelector('div:nth-child(2)');
            if (contentDiv) {
                contentDiv.textContent += content;
            }
        }
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Remove both finalizeStream functions as they're no longer needed

    // Focus input on load
    messageInput.focus();
    
    // Initialize as disconnected
    updateConnectionStatus(false, 'Connecting to GPTme server...');
    
    // Log that we're ready
    console.log('GPTme webview initialized');
})();
