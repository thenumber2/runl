# RunL API

A robust and scalable event-driven API service that supports data management, event logging, and webhook forwarding.

## Features

- **Event Streaming**: Log, track, and forward events to multiple destinations
- **Webhook Forwarding**: Forward events to external services with powerful transformation capabilities
- **Flexible Data Management**: Store and retrieve structured data with validation
- **Stripe Integration**: Secure webhook handling for payment events
- **Schema Management**: Create and modify database tables programmatically
- **Transformation Framework**: Transform event data for various destinations
- **Route Management**: Configure how events are routed based on event types and conditions
- **Redis Caching**: Performant caching with fallback mechanisms
- **Security**: API key authentication, rate limiting, and XSS protection

## Architecture

The RunL API follows a modular architecture with the following components:

### Core Components

- **Data Management**: Store and retrieve JSON data with validation
- **Event System**: Track, log, and forward events to configured destinations
- **Schema Management**: Create and manage database tables
- **Integration Framework**: Connect to external services (Stripe, etc.)

### Event Forwarding System

- **Webhook Forwarder**: Send events to external HTTP endpoints
- **Transformation Service**: Transform events for different destinations
- **Event Router**: Route events based on configurable rules
- **Destinations**: Configure external services to receive events

### Service Integrations

- **Stripe Integration**: Handle payment events securely
- **Custom Webhook Destinations**: Send events to any HTTP endpoint
- **Slack Integration**: Format and send events to Slack channels
- **Mixpanel Integration**: Track events in Mixpanel analytics

## Getting Started

### Prerequisites

- Node.js (v14+)
- PostgreSQL (v13+)
- Redis (optional, for caching)
- Docker and Docker Compose (optional, for containerized deployment)

### Environment Variables

Create a `.env` file with the following variables:

```
# Server
PORT=3000
NODE_ENV=development

# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=runl
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_password

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Security
API_KEY=your_api_key
ENCRYPTION_MASTER_KEY=your_encryption_key

# Stripe (optional)
STRIPE_SECRET_KEY=your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=your_stripe_webhook_secret
```

### Installation

1. Clone the repository
   ```bash
   git clone https://github.com/thenumber2/runl.git
   cd runl
   ```

2. Install dependencies
   ```bash
   npm install
   ```

3. Start the server
   ```bash
   npm start
   ```

### Using Docker

1. Build and start the services
   ```bash
   docker-compose up -d
   ```

2. Access the API at `http://localhost:3000`

## API Documentation

### Authentication

All API endpoints (except health checks and Stripe webhooks) require an API key for authentication.

Include the API key in the request header:
```
X-API-Key: your_api_key
```

### Core Endpoints

#### Health Check

```
GET /health
```

Returns server health status.

#### Data Management

```
POST /api/data
GET /api/data
GET /api/data/:id
PUT /api/data/:id
DELETE /api/data/:id
POST /api/data/batch
```

#### Event System

```
POST /api/events
GET /api/events
GET /api/events/:id
GET /api/events/user/:userId
GET /api/events/search
POST /api/events/:id/forward
```

#### Schema Management

```
GET /api/admin/schema
GET /api/admin/schema/tables/:tableName
POST /api/admin/schema/tables
POST /api/admin/schema/templates/:templateName
```

#### Webhook Destinations

```
POST /api/destinations
GET /api/destinations
GET /api/destinations/:id
PUT /api/destinations/:id
DELETE /api/destinations/:id
PATCH /api/destinations/:id/toggle
POST /api/destinations/:id/test
GET /api/destinations/stats
```

#### Transformations

```
POST /api/transformations
GET /api/transformations
GET /api/transformations/:id
PUT /api/transformations/:id
DELETE /api/transformations/:id
PATCH /api/transformations/:id/toggle
POST /api/transformations/:id/test
```

#### Event Routes

```
POST /api/routes
GET /api/routes
GET /api/routes/:id
PUT /api/routes/:id
DELETE /api/routes/:id
PATCH /api/routes/:id/toggle
POST /api/routes/:id/test
```

#### Stripe Integration

```
POST /api/integrations/stripe/webhook
POST /api/integrations/stripe/reprocess
GET /api/integrations/stripe/stats
```

## Development

### Project Structure

```
api/
├── src/
│   ├── controllers/       # Request handlers
│   ├── db/                # Database connection
│   ├── middleware/        # Express middleware
│   ├── models/            # Database models
│   ├── routes/            # API routes
│   ├── services/          # Core services
│   ├── templates/         # SQL templates
│   ├── utils/             # Utility functions
│   └── index.js           # Entry point
├── .env                   # Environment variables
└── package.json          
```

### Key Service Components

- **Logger (winston)**: Structured logging for production and development
- **Redis Service**: Caching and failover strategies
- **Webhook Forwarder**: Forward events to external services
- **Event Router**: Route events based on configurable rules
- **Transformation Service**: Transform events for different destinations
- **Crypto Utilities**: Handle secure encryption/decryption

## Security Features

- **API Key Authentication**: Simple API key authentication for all endpoints
- **XSS Protection**: Request sanitization middleware
- **Rate Limiting**: Prevent abuse with configurable rate limits
- **Secure Headers**: Helmet integration for security headers
- **SQL Injection Protection**: Parameterized queries and validation
- **Secrets Encryption**: Encrypted storage of sensitive data
- **Logging**: Detailed logging with sensitive data masking

## Advanced Features

### Event Transformation Types

The system supports various transformation types:

- **Identity**: No transformation, pass event as-is
- **Mapping**: Simple field mapping and filtering
- **Template**: Lodash template-based transformation
- **JSONPath**: Extract data using JSONPath expressions
- **Script**: Configurable script-based transformations
- **Slack**: Format events for Slack webhooks
- **Mixpanel**: Format events for Mixpanel tracking

### Event Routing Conditions

Route events based on:

- **Event Type**: Match by exact name or pattern
- **Property Conditions**: Match based on event properties
- **JSONPath Conditions**: Advanced JSON data matching
- **Script Conditions**: Custom conditional logic

### Redis Caching

- **Pattern-based Invalidation**: Smart cache invalidation
- **Fallback Mechanisms**: Graceful degradation when Redis is unavailable
- **TTL Management**: Configurable time-to-live settings
- **Batch Operations**: Efficient multi-key operations

## Monitoring and Debugging

- **Structured Logging**: JSON logs with contextual metadata
- **Request Logging**: HTTP request logging with morgan
- **Error Tracking**: Detailed error logs with stack traces
- **Redis Status**: Connection health monitoring
- **Event Statistics**: Track event routing and delivery metrics
