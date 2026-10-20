import type { WebContents } from 'electron'
import { IpcChannels } from '../../shared/ipc'
import type { AuthService } from '../auth/authService'
import { handle } from './registerHandlers'

export interface AuthHandlerDeps {
  auth: AuthService
  /** Sign-in belongs to the main window; the widget and notification pages may not call it. */
  isMainWindow: (sender: WebContents) => boolean
}

/**
 * Optional sign-in IPC (Phase 5C). Inputs are untyped strings validated in `AuthService`; answers are
 * `AuthStatus`-shaped and never contain a token or refresh token.
 */
export function registerAuthHandlers({ auth, isMainWindow }: AuthHandlerDeps): void {
  const mainOnly = (sender: WebContents): void => {
    if (!isMainWindow(sender)) throw new Error('Sign-in is only available in the main window')
  }
  handle(IpcChannels.authStatus, (event) => (mainOnly(event.sender), auth.status()))
  handle(IpcChannels.authRequestCode, (event, email: unknown) => (mainOnly(event.sender), auth.requestCode(email)))
  handle(IpcChannels.authVerifyCode, (event, code: unknown) => (mainOnly(event.sender), auth.verifyCode(code)))
  handle(IpcChannels.authCancel, (event) => (mainOnly(event.sender), auth.cancel()))
  handle(IpcChannels.authSignOut, (event) => (mainOnly(event.sender), auth.signOut()))
}
