#!/bin/bash

# ScoZo Netball Scorer - Deployment Script
# This script helps deploy the app to Vercel

echo "🏀 ScoZo Netball Scorer - Deployment Script"
echo "============================================="

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo "❌ Vercel CLI not found. Installing..."
    npm install -g vercel
fi

# Check if .env.local exists
if [ ! -f .env.local ]; then
    echo "❌ .env.local file not found!"
    echo ""
    echo "Please create a .env.local file with your Firebase configuration:"
    echo ""
    echo "NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key_here"
    echo "NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project_id.firebaseapp.com"
    echo "NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id"
    echo "NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project_id.appspot.com"
    echo "NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_messaging_sender_id"
    echo "NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id"
    echo ""
    echo "You can get these values from your Firebase project settings."
    exit 1
fi

# Build the project
echo "🔨 Building the project..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Build failed! Please fix the errors and try again."
    exit 1
fi

echo "✅ Build successful!"

# Deploy to Vercel
echo "🚀 Deploying to Vercel..."
vercel --prod

echo ""
echo "🎉 Deployment complete!"
echo ""
echo "Next steps:"
echo "1. Set up your environment variables in Vercel dashboard"
echo "2. Configure your custom domain (optional)"
echo "3. Share your app with the netball community!"
echo ""
echo "For help, check the README.md file or visit: https://vercel.com/docs"
