# ScoZo Netball Scorer MVP

A professional netball scoring application built with Next.js, Firebase, and TypeScript.

## Features

- **Real-time Scoring**: Live score updates with instant synchronization
- **Mobile Optimized**: Perfect for sideline scoring on any device
- **Professional Features**: Quarter tracking, break management, and more
- **Secure & Private**: Your game data is protected and private
- **Detailed Statistics**: Comprehensive game analysis and reporting
- **Lightning Fast**: Optimized for quick, responsive scoring

## Guest Mode

ScoZo supports guest users who can play without creating an account:

### How Guest Mode Works

- **Local Storage**: Games are saved locally on your device using browser localStorage
- **Device Persistence**: Your games persist between browser sessions on the same device
- **No Registration Required**: Start scoring immediately without email/password
- **Privacy**: All data stays on your device - nothing is sent to our servers

### Guest Mode Limitations

- Games are only saved on the current device
- Data will be lost if you clear browser data/cookies
- Games cannot be accessed from other devices
- No cloud backup or sharing capabilities

### Switching to Full Account

To get permanent cloud storage and access from any device:
1. Click "Sign Up" from the guest interface
2. Create an account with email/password
3. Your guest games will remain on your device
4. New games will be saved to the cloud

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Firebase project (see [FIREBASE_SETUP.md](./FIREBASE_SETUP.md))

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd netball_scorer_mvp
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
# Run the setup script to create .env.local
chmod +x scripts/setup-env.sh
./scripts/setup-env.sh
```

4. Start the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000) in your browser

## Environment Variables

Create a `.env.local` file with your Firebase configuration:

```env
NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_project.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=your_measurement_id
```

## Usage

### Starting a New Game

1. Click "Start New Game" from the home page
2. Enter team names and game settings
3. Click "Create Game" to begin scoring

### During the Game

- Use the scoring interface to track goals
- Monitor quarter times and breaks
- View live statistics and scores

### After the Game

- Games are automatically saved
- View completed games in "Past Games"
- Share game results with others

## Development

### Project Structure

```
app/
├── components/          # React components
├── contexts/           # React contexts (Auth, etc.)
├── game/              # Game scoring interface
├── lib/               # Utility functions and Firebase config
├── new/               # New game creation
├── past-games/        # Game history
└── view/              # Game viewing/analysis
```

### Key Technologies

- **Frontend**: Next.js 14, React 18, TypeScript
- **Styling**: Tailwind CSS
- **Backend**: Firebase (Auth, Firestore)
- **State Management**: React Context + Hooks
- **Local Storage**: Browser localStorage for guest users

### Building for Production

```bash
npm run build
npm start
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Support

For support or questions, please open an issue in the repository.
