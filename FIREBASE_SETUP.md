# Firebase Setup Guide for ScoZo

This guide will walk you through setting up Firebase for your ScoZo Netball Scorer app.

## Step 1: Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Create a project" or "Add project"
3. Enter a project name (e.g., "scozo-netball-scorer")
4. Choose whether to enable Google Analytics (optional)
5. Click "Create project"

## Step 2: Enable Authentication

1. In your Firebase project, click "Authentication" in the left sidebar
2. Click "Get started"
3. Go to the "Sign-in method" tab
4. Click "Email/Password"
5. Enable "Email/Password" authentication
6. Click "Save"
7. **Enable Anonymous Authentication** (for guest users):
   - Click "Anonymous" in the sign-in methods list
   - Enable "Anonymous" authentication
   - Click "Save"

## Step 3: Create Firestore Database

1. Click "Firestore Database" in the left sidebar
2. Click "Create database"
3. Choose "Start in test mode" (we'll secure it later)
4. Select a location close to your users
5. Click "Done"

## Step 4: Get Project Configuration

1. Click the gear icon (⚙️) next to "Project Overview"
2. Select "Project settings"
3. Scroll down to "Your apps" section
4. Click the web icon (</>)
5. Register your app with a nickname (e.g., "ScoZo Web App")
6. Copy the configuration object

## Step 5: Set Environment Variables

Create a `.env.local` file in your project root with the copied values:

```bash
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key_here
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project_id.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
```

## Step 6: Secure Firestore Rules

1. Go to "Firestore Database" → "Rules"
2. Replace the default rules with:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can only access their own games
    match /games/{gameId} {
      allow read, write: if request.auth != null && request.auth.uid == resource.data.ownerId;
      allow create: if request.auth != null;
    }
  }
}
```

3. Click "Publish"

## Step 7: Test Your Setup

1. Run your development server: `npm run dev`
2. Open [http://localhost:3000](http://localhost:3000)
3. Try to sign up with a new account
4. Check Firebase Console to see if the user was created

## Troubleshooting

### Common Issues

**"Firebase: Error (auth/invalid-api-key)"**
- Check that your API key is correct in `.env.local`
- Make sure the file is in the project root

**"Firebase: Error (auth/operation-not-allowed)"**
- Ensure Email/Password authentication is enabled in Firebase Console

**"Firebase: Error (permission-denied)"**
- Check your Firestore security rules
- Make sure you're signed in before accessing the database

**"Firebase: Error (auth/network-request-failed)"**
- Check your internet connection
- Verify your Firebase project is in the correct region

### Getting Help

- [Firebase Documentation](https://firebase.google.com/docs)
- [Firebase Support](https://firebase.google.com/support)
- [Firebase Community](https://firebase.google.com/community)

## Next Steps

Once Firebase is set up:

1. ✅ Test authentication locally
2. ✅ Create your first game
3. ✅ Deploy to Vercel
4. 🎉 Share with the netball community!

---

**Need help?** Check the main README.md or open an issue on GitHub.
