#!/bin/bash

# ScoZo Netball Scorer - Environment Setup Script
echo "🏀 Setting up environment variables for ScoZo Netball Scorer..."

# Check if .env.local already exists
if [ -f ".env.local" ]; then
    echo "⚠️  .env.local already exists. Backing up to .env.local.backup"
    cp .env.local .env.local.backup
fi

# Create .env.local with the current Firebase config values
cat > .env.local << 'EOF'
# Firebase Configuration for ScoZo Netball Scorer
# These values are from your current Firebase project

NEXT_PUBLIC_FIREBASE_API_KEY=AIzaSyBzmO3jnffP7IxEOGsrEZUS2YrniJ9BKwQ
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=scozo-aug-ver.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=scozo-aug-ver
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=scozo-aug-ver.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=1008137827054
NEXT_PUBLIC_FIREBASE_APP_ID=1:1008137827054:web:2d3f6667af91421276b9ff
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-Y5JK3PR0TG
EOF

echo "✅ .env.local created successfully!"
echo "📝 Please review the file and update any values if needed"
echo "🔒 Remember: .env.local is already in .gitignore and won't be committed"
echo ""
echo "🚀 You can now run: npm run dev"
