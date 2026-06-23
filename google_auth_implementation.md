# Google OAuth Popup Login & Backend Verification Setup

We have successfully implemented Google OAuth Popup authentication for the **BIT Software & IT Solution** application. This implementation replaces page redirects with a sleek, modern popup flow, matching the user experience of applications like ChatGPT and Notion.

Here is a summary of the implementation, code review, and setup guide.

---

## 🛠️ Summary of Changes

### 1. Backend Modifications (Node.js + Express + TypeScript)

*   **Installed Dependencies**: Installed `google-auth-library` to handle secure server-side Google token verification.
*   **Environment Configuration**:
    *   Added `google_client_id` configuration in [src/app/config/index.ts](file:///d:/Jakir-Vai/BIT_Software_&_IT_Soilution_Backend/src/app/config/index.ts) mapped to `process.env.GOOGLE_CLIENT_ID`.
    *   Added a placeholder `GOOGLE_CLIENT_ID` in [.env](file:///d:/Jakir-Vai/BIT_Software_&_IT_Soilution_Backend/.env).
*   **Zod Schema Validation**:
    *   Added `googleVerifyValidationSchema` in [src/app/modules/Auth/auth.validation.ts](file:///d:/Jakir-Vai/BIT_Software_&_IT_Soilution_Backend/src/app/modules/Auth/auth.validation.ts) to validate the incoming `idToken` payload.
*   **Route Definition**:
    *   Added `POST /api/v1/auth/google-verify` route in [src/app/modules/Auth/auth.routes.ts](file:///d:/Jakir-Vai/BIT_Software_&_IT_Soilution_Backend/src/app/modules/Auth/auth.routes.ts).
*   **Service Layer (`googleVerify`)**:
    *   Implemented token verification logic in [src/app/modules/Auth/auth.service.ts](file:///d:/Jakir-Vai/BIT_Software_&_IT_Soilution_Backend/src/app/modules/Auth/auth.service.ts).
    *   **Dual-Token Verification Support (Highly Robust)**: The backend automatically checks if the received token is a JWT (ID Token) or an Access Token.
        *   If it's an **ID Token**: Verifies it securely using `google-auth-library`'s `verifyIdToken`.
        *   If it's an **Access Token**: Fetches profile data directly from Google's secure `userinfo` API.
    *   **User Provisioning**:
        *   If the user already exists in the database, checks if they are blocked or deleted, and logs them in.
        *   If the user does not exist, registers a new account automatically using their Google profile name, email, and avatar picture, while generating a cryptographically secure random password to satisfy the database schema's requirement.
    *   **Token Issuance**: Issues local access and refresh tokens, returning the user payload and JWT token.
*   **Controller Layer**:
    *   Implemented `googleVerify` in [src/app/modules/Auth/auth.controller.ts](file:///d:/Jakir-Vai/BIT_Software_&_IT_Soilution_Backend/src/app/modules/Auth/auth.controller.ts).
    *   Sends local `refreshToken` securely in an `httpOnly` cookie and returns the `accessToken` and user object.

### 2. Frontend Modifications (React)

*   **Installed Dependencies**: Installed `@react-oauth/google` in the frontend workspace.
*   **Configuration**:
    *   Added `VITE_GOOGLE_CLIENT_ID=YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com` in [D:\Jakir-Vai\BIT_Software_&_IT_Soilution_Frontend\.env](file:///D:/Jakir-Vai/BIT_Software_&_IT_Soilution_Frontend/.env).
*   **App Initialization**:
    *   Wrapped the React provider tree in [D:\Jakir-Vai\BIT_Software_&_IT_Soilution_Frontend\src\App.jsx](file:///D:/Jakir-Vai/BIT_Software_&_IT_Soilution_Frontend/src/App.jsx) with `<GoogleOAuthProvider clientId={googleClientId}>`.
*   **API Layer**:
    *   Added `googleVerify` API request in [D:\Jakir-Vai\BIT_Software_&_IT_Soilution_Frontend\src\api\authApi.js](file:///D:/Jakir-Vai/BIT_Software_&_IT_Soilution_Frontend/src/api/authApi.js).
*   **UI Integration**:
    *   Integrated Google login hook `useGoogleLogin` into [D:\Jakir-Vai\BIT_Software_&_IT_Soilution_Frontend\src\pages\Auth\Login.jsx](file:///D:/Jakir-Vai/BIT_Software_&_IT_Soilution_Frontend/src/pages/Auth/Login.jsx) and bound it to the custom styled Google login button.
    *   Integrated the same flow into [D:\Jakir-Vai\BIT_Software_&_IT_Soilution_Frontend\src\pages\Auth\Register.jsx](file:///D:/Jakir-Vai/BIT_Software_&_IT_Soilution_Frontend/src/pages/Auth/Register.jsx) for frictionless signup.
    *   Handled loading and error states gracefully, dispatching credentials to the Redux store upon successful login.

---

## 🔍 Code Review & Verification

1.  **TypeScript & Backend Build**: Tested type safety by running the TypeScript compiler:
    ```powershell
    node ./node_modules/typescript/bin/tsc --noEmit
    ```
    *Result: Successful compilation with no errors.*
2.  **Frontend Production Build**: Tested Vite build to ensure correct bundling:
    ```powershell
    npm run build
    ```
    *Result: Bundled successfully in 1.00s.*
3.  **Security**:
    *   Backend verification prevents token falsification by checking credentials on Google's own API servers.
    *   Auto-generated passwords for Google registrations are cryptographically secure (`crypto.randomBytes(16)`), preventing password guessing.
    *   Local credentials use the existing httpOnly cookie strategy for refresh tokens, preventing XSS-based token theft.

---

## 🚀 Setup Instructions for the User

To enable the login popup to connect to your Google Client App, please follow these steps:

### Step 1: Create Google OAuth Credentials
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Select your project (or create a new one).
3. Navigate to **APIs & Services** > **Credentials**.
4. Click **Create Credentials** and choose **OAuth client ID**.
5. Set the Application type to **Web application**.
6. Under **Authorized JavaScript origins**, add your local frontend URL (e.g., `http://localhost:5173`).
7. Under **Authorized redirect URIs**, add your local frontend URL (or leave blank if using popup/implicit flow).
8. Copy the generated **Client ID**.

### Step 2: Add Client ID to Environment Variables
1. **Frontend**: Open [D:\Jakir-Vai\BIT_Software_&_IT_Soilution_Frontend\.env](file:///D:/Jakir-Vai/BIT_Software_&_IT_Soilution_Frontend/.env) and replace the value of `VITE_GOOGLE_CLIENT_ID`:
   ```env
   VITE_GOOGLE_CLIENT_ID=your-actual-client-id.apps.googleusercontent.com
   ```
2. **Backend**: Open [d:\Jakir-Vai\BIT_Software_&_IT_Soilution_Backend\.env](file:///d:/Jakir-Vai/BIT_Software_&_IT_Soilution_Backend/.env) and replace the value of `GOOGLE_CLIENT_ID`:
   ```env
   GOOGLE_CLIENT_ID=your-actual-client-id.apps.googleusercontent.com
   ```
3. Restart both the Frontend and Backend servers to apply changes!
