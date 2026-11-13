/**
 * dsh-margin-notes — node half.
 *
 * The whole feature lives in the browser half (client.js): text selection,
 * annotation popover, and the batch send into the composer. The node half only
 * exists so the bundle patch can insert a healthy Cordis plugin row.
 */

/** Cordis plugin name. */
export const name = 'dsh-margin-notes'

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 */
export function apply(ctx) {
  ctx.logger('dsh-margin-notes').debug('client-only plugin loaded')
}
