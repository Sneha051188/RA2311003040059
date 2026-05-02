# Campus Hiring Evaluation - Backend Track

This repository contains the completed backend evaluation project built with Node.js, adhering to clean architecture, modular design, and robust error handling.

## Project Structure

```
RA2311003040059/
│
├── logging_middleware/
│   └── logger.js                 # Centralized remote logging middleware
│
├── vehicle_maintence_scheduler/
│   └── index.js                  # 0/1 Knapsack dynamic programming implementation
│
├── notification_app_be/
│   └── priority.js               # Priority queue sorting logic based on Type and Recency
│
├── notification_system_design.md # High-level system architecture and system design
├── auth.js                       # API Authentication flow handling
├── .env                          # Environment variables (excluded from Git)
├── .gitignore                    # Excludes node_modules and .env
└── package.json                  # Dependencies and execution scripts
```

## Features Implemented
1. **Secure Authentication Flow**: The `auth.js` module automatically handles registration and Bearer token retrieval, persisting credentials safely to `.env`.
2. **Centralized Remote Logging**: `logger.js` catches all execution logs and dynamically relays them to the evaluation service without interrupting the main application thread.
3. **Vehicle Maintenance Scheduler**: Employs a dynamic programming 0/1 Knapsack algorithm to maximize impact scores based on mechanic hours.
4. **Notification Priority Queue**: Efficient sorting algorithm that assigns custom heuristic weights to 'Placement', 'Event', and 'Result' tags combined with epoch timestamp ranking.
5. **System Design Document**: A comprehensive architectural document detailing PostgreSQL indexing, Redis caching, RabbitMQ message queues, and REST API definitions.

## Execution Guide

Make sure to populate your `.env` file with your details before running.

1. **Authentication:**
   ```bash
   npm run auth
   ```
2. **Execute Scheduler:**
   ```bash
   npm run scheduler
   ```
3. **Execute Priority System:**
   ```bash
   npm run notify
   ```

## Dependencies
- Node.js (v18+)
- `axios`
- `dotenv`
