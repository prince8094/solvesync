/**
 * SolveSync — sign-in configuration (developer sets this once).
 *
 * WEB_CLIENT_ID
 *   OAuth client ID of type "Web application". It is used for the browser-independent
 *   sign-in that works in Brave, Edge, Opera and Vivaldi (Chrome's built-in Google
 *   sign-in does not exist there). In Google Cloud Console add this exact redirect URI
 *   to that client:   https://<your-extension-id>.chromiumapp.org/
 *   (Settings -> "Having trouble signing in?" shows the exact value to copy.)
 *   Leave it empty if you only target Google Chrome. See docs/GOOGLE_SETUP.md, section 7.
 *
 * The client ID for Google Chrome's built-in sign-in is NOT here: it stays in manifest.json
 * under "oauth2" (client type "Chrome Extension").
 */
var WEB_CLIENT_ID = '';
