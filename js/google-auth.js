// Google sign-in with Google's own library (Google Identity Services). The page gets a
// short-lived access token for one scope at a time. No client secret: the client ID is public.
import { CONFIG } from '../config.js';
import { loadScript } from './util.js';

const GIS = 'https://accounts.google.com/gsi/client';
const tokens = new Map(); // scope -> { token, expires }

export const googleConfigured = () => Boolean(CONFIG.googleClientId);

// Load early (e.g. when a dialog opens), so the sign-in popup opens straight from the click.
export const preloadGoogle = () => (googleConfigured() ? loadScript(GIS, { cors: false }).catch(() => {}) : Promise.resolve());

export async function getToken(scope) {
  const t = tokens.get(scope);
  if (t && Date.now() < t.expires) return t.token;
  await loadScript(GIS, { cors: false });
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.googleClientId,
      scope,
      callback: (r) => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        if (window.google.accounts.oauth2.hasGrantedAllScopes && !window.google.accounts.oauth2.hasGrantedAllScopes(r, scope)) {
          return reject(new Error('Google didn’t give permission. Tick the box in the Google window to allow it.'));
        }
        tokens.set(scope, { token: r.access_token, expires: Date.now() + (Number(r.expires_in || 3600) - 120) * 1000 });
        resolve(r.access_token);
      },
      error_callback: (e) => reject(new Error(e?.type === 'popup_closed' ? 'The Google window was closed.' : e?.type === 'popup_failed_to_open' ? 'The browser blocked the Google window. Allow pop-ups for this site and try again.' : 'Google sign-in didn’t work.')),
    });
    client.requestAccessToken();
  });
}

export const forgetToken = (scope) => tokens.delete(scope);
