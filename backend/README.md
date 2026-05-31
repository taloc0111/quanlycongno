# Debt Management Backend API

## Setup Instructions

### 1. Install PostgreSQL
Download and install PostgreSQL from: https://www.postgresql.org/download/

### 2. Create Database
```bash
# Login to PostgreSQL
psql -U postgres

# Run the database.sql file
\i /path/to/database.sql
```

### 3. Configure Environment
Copy `.env.example` to `.env` and update with your database credentials

### 4. Install Dependencies
```bash
npm install
```

### 5. Run Server
```bash
# Development
npm run dev

# Production
npm start
```

## API Endpoints

### Authentication
- POST `/api/auth/login` - Login
- POST `/api/auth/register` - Register new user
- GET `/api/auth/profile` - Get user profile (requires auth)

### Debts
- GET `/api/debts` - Get all debts (with filters)
- POST `/api/debts` - Create new debt
- POST `/api/debts/bulk` - Create multiple debts
- PUT `/api/debts/:id` - Update debt
- DELETE `/api/debts/:id` - Delete debt

### Companies
- GET `/api/companies` - Get all companies
- POST `/api/companies` - Create company
- PUT `/api/companies/:id` - Update company
- DELETE `/api/companies/:id` - Delete company
- GET `/api/companies/:id/debts` - Get company debt summary

### Routes
- GET `/api/routes` - Get all routes
- POST `/api/routes` - Create route
- DELETE `/api/routes/:id` - Delete route

## Default Login
Username: `admin`
Password: `admin123`