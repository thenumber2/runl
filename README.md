# Runl API Service

A RESTful API service for receiving data and inserting it into a PostgreSQL database.

## Features

- RESTful API endpoints for CRUD operations
- PostgreSQL integration with Sequelize ORM
- Redis caching for improved performance
- Input validation with Joi
- Error handling and logging
- Rate limiting
- Docker containerization
- Traefik integration

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/data | Create a new data entry |
| POST | /api/data/batch | Create multiple data entries in a single transaction |
| GET | /api/data | Get all data entries with pagination |
| GET | /api/data/:id | Get a single data entry by ID |
| PUT | /api/data/:id | Update a data entry |
| DELETE | /api/data/:id | Delete a data entry |
| GET | /health | Health check endpoint |
