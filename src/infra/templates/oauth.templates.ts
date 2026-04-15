/**
 * HTML templates for OAuth (e.g. Google authorize popup, callback).
 * Centralized under infra/templates for reuse across modules.
 */

export * from './auth-email.templates';

export interface GoogleCallbackMessage {
  type: string;
  credential?: string;
  error?: string;
}

/**
 * Popup page "Connecting to Google..." with redirect link to Google OAuth.
 */
export function getGoogleAuthorizePageHtml(oauthUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Google Authentication</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: Arial, sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; color: #333; }
    .container { text-align: center; padding: 20px; }
    .loader { border: 4px solid #f3f3f3; border-radius: 50%; border-top: 4px solid #E53E3E; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto 20px; }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    .button { background: #E53E3E; color: white; border: none; padding: 12px 24px; text-align: center; text-decoration: none; display: inline-block; font-size: 16px; font-weight: bold; margin: 20px 0; cursor: pointer; border-radius: 4px; }
    .button:hover { background: #C53030; }
  </style>
</head>
<body>
  <div class="container">
    <div class="loader"></div>
    <a class="button" href="${escapeHtml(oauthUrl)}" id="loginBtn">Connecting to Google...</a>
  </div>
  <script>setTimeout(function(){ document.getElementById('loginBtn').click(); }, 500);</script>
</body>
</html>`;
}

/**
 * Callback page: postMessage to opener (app) then close popup.
 */
export function getGoogleCallbackPageHtml(
  messageData: GoogleCallbackMessage,
  targetOrigin: string,
): string {
  const isError = messageData.type.includes('ERROR');
  const title = isError ? 'Authentication Failed' : 'Authentication Successful';
  const dataStr = JSON.stringify(messageData);
  const safeOrigin = targetOrigin.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `<!DOCTYPE html>
<html>
<head>
  <title>Google Authentication</title>
  <style>
    body { font-family: Arial, sans-serif; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .container { text-align: center; padding: 20px; }
    .success { color: #38A169; }
    .error { color: #E53E3E; }
  </style>
</head>
<body>
  <div class="container">
    <h2 class="${isError ? 'error' : 'success'}">${escapeHtml(title)}</h2>
    <p>You can close this window now.</p>
  </div>
  <script>
(function(){
  var target = "${safeOrigin}";
  try { if (window.opener) window.opener.postMessage(${dataStr}, target); } catch (e) {}
  setTimeout(function(){ window.close(); }, 1000);
})();
  </script>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
