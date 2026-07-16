(function(global) {
    'use strict';

    const USER_COLORS = ['u-purple', 'u-blue', 'u-pink', 'u-green'];

    function colorForUser(userId) {
        let hash = 0;
        for (let i = 0; i < userId.length; i++) {
            hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
        }
        return USER_COLORS[Math.abs(hash) % USER_COLORS.length];
    }

    function formatTime(timestamp) {
        const date = new Date(timestamp);
        return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
    }

    function initialFromUsername(username) {
        return (username || '?').charAt(0).toUpperCase();
    }

    class ChatUI {
        constructor(options = {}) {
            this.$messages = $(options.messagesSelector || '.chat-panel[data-panel="chat"] .chat-messages');
            this.onUserHover = options.onUserHover || function() {};
            this.renderedIds = new Set();
        }

        clear() {
            this.$messages.empty();
            this.renderedIds.clear();
        }

        renderHistory(messages) {
            this.clear();
            messages.forEach((message) => this.appendMessage(message, false));
            this.scrollToBottom();
        }

        appendMessage(message, scroll = true) {
            if (!message?.id || this.renderedIds.has(message.id)) return;
            this.renderedIds.add(message.id);

            const colorClass = colorForUser(message.user.id);
            const initial = initialFromUsername(message.user.username);
            const $msg = $(`
                <li class="chat-msg user-card-target" data-user="${message.user.username}" data-user-id="${message.user.id || ''}" data-client-id="${message.user.clientId || ''}" data-avatar="${message.user.avatar || ''}">
                    <span class="mini-avatar av-1">${initial}</span>
                    <div class="msg-body">
                        <div class="msg-meta">
                            <span class="msg-user ${colorClass}">${message.user.username}</span>
                            <time>${formatTime(message.timestamp)}</time>
                        </div>
                        <p></p>
                    </div>
                </li>
            `);
            $msg.find('p').text(message.message);
            this.$messages.append($msg);

            if (scroll) this.scrollToBottom();
        }

        scrollToBottom() {
            const node = this.$messages[0];
            if (node) node.scrollTop = node.scrollHeight;
        }
    }

    global.PlugDJ = global.PlugDJ || {};
    global.PlugDJ.ChatUI = ChatUI;
    global.PlugDJ.colorForUser = colorForUser;
})(window);
