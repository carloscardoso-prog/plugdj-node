(function(global) {
    'use strict';

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    class ModalUI {
        constructor() {
            this.$root = null;
            this.onSubmit = null;
            this.onCancel = null;
        }

        close(reason = 'dismiss') {
            const cancel = this.onCancel;
            if (this.$root) {
                this.$root.remove();
                this.$root = null;
            }
            this.onSubmit = null;
            this.onCancel = null;
            if (reason === 'cancel' && typeof cancel === 'function') {
                cancel();
            }
        }

        /** Close via Cancel / Esc / optional backdrop — notifies promptAsync. */
        cancel() {
            this.close('cancel');
        }

        open(options = {}) {
            this.close('dismiss');

            const title = options.title || '';
            const confirmLabel = options.confirmLabel || 'Save';
            const cancelLabel = options.cancelLabel || 'Cancel';
            const fields = options.fields || [];
            const message = options.message || '';
            const danger = !!options.danger;
            const closeOnBackdrop = options.closeOnBackdrop === true;
            const backdropClass = ['plug-modal-backdrop', options.backdropClass]
                .filter(Boolean)
                .join(' ');

            let bodyHtml = '';
            if (message) {
                bodyHtml += `<p class="plug-modal__message">${escapeHtml(message)}</p>`;
            }
            fields.forEach((field) => {
                const id = `plug-modal-field-${field.name}`;
                const label = escapeHtml(field.label || field.name);
                const value = escapeHtml(field.value || '');
                const placeholder = escapeHtml(field.placeholder || '');
                const maxlength = field.maxlength ? ` maxlength="${field.maxlength}"` : '';
                if (field.type === 'textarea') {
                    bodyHtml += `
                        <label class="plug-modal__label" for="${id}">${label}</label>
                        <textarea id="${id}" class="plug-modal__textarea" name="${field.name}" placeholder="${placeholder}" rows="${field.rows || 3}"${maxlength}>${value}</textarea>
                    `;
                } else {
                    bodyHtml += `
                        <label class="plug-modal__label" for="${id}">${label}</label>
                        <input id="${id}" class="plug-modal__input" type="${field.type || 'text'}" name="${field.name}" value="${value}" placeholder="${placeholder}"${maxlength}>
                    `;
                }
            });

            // Use a <form> so Enter submits via our handler — never a full page navigation
            const $backdrop = $(`
                <div class="${backdropClass}" role="dialog" aria-modal="true">
                    <form class="plug-modal glass" novalidate>
                        <button type="button" class="plug-modal__close" aria-label="Close">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
                        </button>
                        <h2 class="plug-modal__title">${escapeHtml(title)}</h2>
                        <div class="plug-modal__body">${bodyHtml}</div>
                        <div class="plug-modal__actions">
                            <button type="button" class="plug-modal__btn plug-modal__btn--cancel">${escapeHtml(cancelLabel)}</button>
                            <button type="submit" class="plug-modal__btn plug-modal__btn--confirm${danger ? ' plug-modal__btn--danger' : ''}">${escapeHtml(confirmLabel)}</button>
                        </div>
                    </form>
                </div>
            `);

            this.$root = $backdrop;
            this.onSubmit = typeof options.onSubmit === 'function' ? options.onSubmit : null;
            this.onCancel = typeof options.onCancel === 'function' ? options.onCancel : null;
            $('body').append($backdrop);

            const $first = $backdrop.find('.plug-modal__input, .plug-modal__textarea').first();
            if ($first.length) {
                setTimeout(() => $first.trigger('focus'), 0);
            }

            const submit = (e) => {
                if (e) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                const values = {};
                fields.forEach((field) => {
                    const $field = $backdrop.find(`[name="${field.name}"]`);
                    values[field.name] = $field.val();
                });
                if (this.onSubmit) {
                    const result = this.onSubmit(values);
                    if (result !== false) this.close('dismiss');
                } else {
                    this.close('dismiss');
                }
            };

            $backdrop.on('submit', 'form.plug-modal', submit);
            $backdrop.on('click', '.plug-modal__close, .plug-modal__btn--cancel', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.cancel();
            });
            if (closeOnBackdrop) {
                $backdrop.on('click', (e) => {
                    if ($(e.target).is('.plug-modal-backdrop')) this.cancel();
                });
            } else {
                // Swallow backdrop clicks so they never bubble to document handlers
                $backdrop.on('click', (e) => {
                    if ($(e.target).is('.plug-modal-backdrop')) {
                        e.preventDefault();
                        e.stopPropagation();
                    }
                });
            }
            $backdrop.on('keydown', '.plug-modal__input, .plug-modal__textarea', (e) => {
                if (e.key === 'Enter' && !e.shiftKey && e.target.tagName !== 'TEXTAREA') {
                    e.preventDefault();
                    submit(e);
                }
            });

            return this;
        }

        prompt(options) {
            return this.open(options);
        }

        /** Promise-based prompt. Resolves with field values, or null if cancelled. */
        promptAsync(options = {}) {
            return new Promise((resolve) => {
                let settled = false;
                const finish = (value) => {
                    if (settled) return;
                    settled = true;
                    resolve(value);
                };

                this.open({
                    ...options,
                    // Default: do NOT close on outside click (prevents accidental navigate-away)
                    closeOnBackdrop: options.closeOnBackdrop === true,
                    onSubmit: (values) => {
                        if (typeof options.onSubmit === 'function') {
                            const result = options.onSubmit(values);
                            if (result === false) return false;
                        }
                        finish(values);
                        return true;
                    },
                    onCancel: () => finish(null)
                });

                if (!this.$root) {
                    finish(null);
                }
            });
        }

        confirm(options) {
            return this.open({
                title: options.title,
                message: options.message,
                confirmLabel: options.confirmLabel || 'Confirm',
                cancelLabel: options.cancelLabel || 'Cancel',
                danger: options.danger,
                onSubmit: () => {
                    if (options.onConfirm) options.onConfirm();
                }
            });
        }
    }

    global.PlugDJ = global.PlugDJ || {};
    global.PlugDJ.ModalUI = ModalUI;
    global.PlugDJ.modal = new ModalUI();
})(window);
