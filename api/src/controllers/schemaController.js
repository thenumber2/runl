const asyncHandler = require('express-async-handler');
const { sequelize } = require('../db/connection');
const logger = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');

/**
 * SQL Identifier sanitization function
 * Validates that identifiers only contain safe characters
 * and properly escapes them for use in SQL statements
 * 
 * @param {string} identifier - SQL identifier to sanitize
 * @param {string} type - Type of identifier (for error messages)
 * @returns {string} - Sanitized and quoted identifier
 * @throws {Error} If identifier contains invalid characters
 */
function sanitizeSqlIdentifier(identifier, type = 'identifier') {
  // Strict validation: only allow alphanumeric and underscore
  if (!identifier || typeof identifier !== 'string') {
    throw new Error(`Invalid ${type}: must be a non-empty string`);
  }
  
  if (!/^[a-zA-Z0-9_]+$/.test(identifier)) {
    throw new Error(`Invalid ${type}: '${identifier}' must contain only alphanumeric characters and underscores`);
  }
  
  // Always quote identifiers to prevent SQL injection and handle reserved words
  return `"${identifier}"`;
}

/**
 * Sanitize SQL data type
 * Validates that data type definitions only contain allowed characters
 * 
 * @param {string} dataType - SQL data type to sanitize
 * @returns {string} - Sanitized data type
 * @throws {Error} If data type contains invalid characters
 */
function sanitizeSqlDataType(dataType) {
  if (!dataType || typeof dataType !== 'string') {
    throw new Error('Invalid data type: must be a non-empty string');
  }
  
  // Only allow alphanumeric, underscore, parentheses, commas, and spaces in data types
  // This covers most PostgreSQL types like VARCHAR(255), NUMERIC(10,2), etc.
  if (!/^[a-zA-Z0-9_\s(),]+$/.test(dataType)) {
    throw new Error(`Invalid data type: '${dataType}' contains disallowed characters`);
  }
  
  return dataType;
}

/**
 * Validate SQL content from templates
 * Performs basic validation to prevent harmful SQL
 * 
 * @param {string} sql - SQL content to validate
 * @returns {boolean} - Whether the SQL passes validation
 */
function validateSqlContent(sql) {
  if (!sql || typeof sql !== 'string') {
    return false;
  }
  
  // Disallow multiple statements (potential for SQL injection)
  if (sql.includes(';') && sql.indexOf(';') !== sql.lastIndexOf(';')) {
    return false;
  }
  
  // Disallow dangerous operations
  const dangerousPatterns = [
    /DROP\s+DATABASE/i,
    /DROP\s+SCHEMA/i,
    /TRUNCATE\s+[a-zA-Z0-9_\s]*(CASCADE|ALL)/i,
    /GRANT\s+ALL/i,
    /CREATE\s+USER/i,
    /ALTER\s+SYSTEM/i,
    /CREATE\s+EXTENSION/i,
    /COPY\s+.*FROM/i,
    /CREATE\s+FUNCTION.*LANGUAGE\s+'?internal'?/i,
    /CREATE\s+PROCEDURE.*LANGUAGE\s+'?internal'?/i
  ];
  
  for (const pattern of dangerousPatterns) {
    if (pattern.test(sql)) {
      return false;
    }
  }
  
  return true;
}

/**
 * Get database health and schema information
 * @route GET /api/admin/schema
 */
const getDatabaseInfo = asyncHandler(async (req, res) => {
  // Use parameterized query instead of direct table_name usage
  const tables = await sequelize.query(`
    SELECT 
      table_name,
      (SELECT count(*) FROM information_schema.columns WHERE table_name = information_schema.tables.table_name) as column_count
    FROM 
      information_schema.tables
    WHERE 
      table_schema = 'public'
    ORDER BY 
      table_name
  `, { type: sequelize.QueryTypes.SELECT });

  res.json({
    success: true,
    database: {
      name: sequelize.config.database,
      dialect: sequelize.options.dialect,
      host: sequelize.config.host,
      tables: tables
    }
  });
});

/**
 * Create a table based on JSON definition with enhanced SQL injection protection
 * @route POST /api/admin/schema/tables
 */
const createTable = asyncHandler(async (req, res) => {
  const { tableName, columns, indexes = [], constraints = [] } = req.body;
  
  // Validate required parameters
  if (!tableName || !columns || !Array.isArray(columns) || columns.length === 0) {
    res.status(400);
    throw new Error('Table name and at least one column are required');
  }
  
  try {
    // Sanitize table name
    const sanitizedTableName = sanitizeSqlIdentifier(tableName, 'table name');
    
    // Start transaction
    const transaction = await sequelize.transaction();
    
    try {
      // Check if table exists - using parameterized query
      const tableExists = await sequelize.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = :tableName
        )
      `, { 
        replacements: { tableName },
        type: sequelize.QueryTypes.SELECT,
        transaction
      });
      
      if (tableExists[0].exists) {
        await transaction.rollback();
        return res.status(400).json({
          success: false,
          message: `Table '${tableName}' already exists`
        });
      }
      
      // Build column definitions
      const columnDefinitions = [];
      
      for (const col of columns) {
        // Validate column definition
        if (!col.name || !col.type) {
          await transaction.rollback();
          res.status(400);
          throw new Error('Each column must have a name and type');
        }
        
        // Sanitize column name and type
        const sanitizedColName = sanitizeSqlIdentifier(col.name, 'column name');
        const sanitizedColType = sanitizeSqlDataType(col.type);
        
        let colDef = `${sanitizedColName} ${sanitizedColType}`;
        
        // Add constraints for the column
        if (col.primaryKey) colDef += ' PRIMARY KEY';
        if (col.unique) colDef += ' UNIQUE';
        if (col.notNull) colDef += ' NOT NULL';
        if (col.defaultValue !== undefined) {
          // Handle different default value types
          if (typeof col.defaultValue === 'string') {
            // Escape string literals
            colDef += ` DEFAULT '${col.defaultValue.replace(/'/g, "''")}'`;
          } else if (col.defaultValue === null) {
            colDef += ' DEFAULT NULL';
          } else {
            // For numeric/boolean values
            colDef += ` DEFAULT ${col.defaultValue}`;
          }
        }
        
        columnDefinitions.push(colDef);
      }
      
      // Process table-level constraints
      const constraintDefinitions = [];
      
      if (constraints && constraints.length > 0) {
        for (const constraint of constraints) {
          if (!constraint.type || !constraint.columns || !Array.isArray(constraint.columns)) {
            continue;
          }
          
          // Sanitize column names
          const sanitizedColumns = constraint.columns.map(col => 
            sanitizeSqlIdentifier(col, 'column name')
          ).join(', ');
          
          let constraintDef = '';
          
          switch (constraint.type) {
            case 'PRIMARY KEY':
              constraintDef = `PRIMARY KEY (${sanitizedColumns})`;
              break;
              
            case 'UNIQUE':
              constraintDef = `UNIQUE (${sanitizedColumns})`;
              break;
              
            case 'CHECK':
              // Check constraints need careful handling
              // This is simplified - a real implementation would need more validation
              if (constraint.definition && typeof constraint.definition === 'string') {
                // Basic validation of check constraint - very restrictive for safety
                if (/^[a-zA-Z0-9_\s<>=!()]+$/.test(constraint.definition)) {
                  constraintDef = `CHECK (${constraint.definition})`;
                }
              }
              break;
              
            case 'FOREIGN KEY':
              if (constraint.references && 
                  constraint.references.table && 
                  constraint.references.columns && 
                  Array.isArray(constraint.references.columns)) {
                
                // Sanitize referenced table and columns
                const refTable = sanitizeSqlIdentifier(constraint.references.table, 'referenced table');
                const refColumns = constraint.references.columns.map(col => 
                  sanitizeSqlIdentifier(col, 'referenced column')
                ).join(', ');
                
                constraintDef = `FOREIGN KEY (${sanitizedColumns}) REFERENCES ${refTable}(${refColumns})`;
                
                // Add ON DELETE/UPDATE actions if specified
                if (constraint.onDelete && ['CASCADE', 'SET NULL', 'SET DEFAULT', 'RESTRICT', 'NO ACTION'].includes(constraint.onDelete)) {
                  constraintDef += ` ON DELETE ${constraint.onDelete}`;
                }
                
                if (constraint.onUpdate && ['CASCADE', 'SET NULL', 'SET DEFAULT', 'RESTRICT', 'NO ACTION'].includes(constraint.onUpdate)) {
                  constraintDef += ` ON UPDATE ${constraint.onUpdate}`;
                }
              }
              break;
          }
          
          if (constraintDef) {
            constraintDefinitions.push(constraintDef);
          }
        }
      }
      
      // Build the final CREATE TABLE statement safely
      const createTableQuery = `
        CREATE TABLE ${sanitizedTableName} (
          ${columnDefinitions.join(',\n          ')}
          ${constraintDefinitions.length > 0 ? ',\n          ' + constraintDefinitions.join(',\n          ') : ''}
        )
      `;
      
      // Execute the create table query
      await sequelize.query(createTableQuery, { transaction });
      
      // Create indexes if provided
      if (indexes && indexes.length > 0) {
        for (const index of indexes) {
          if (!index.columns || !Array.isArray(index.columns) || index.columns.length === 0) {
            continue;
          }
          
          // Generate a safe index name if not provided
          const indexName = index.name 
            ? sanitizeSqlIdentifier(index.name, 'index name')
            : sanitizeSqlIdentifier(`${tableName}_${index.columns.join('_')}_idx`, 'index name');
          
          // Sanitize index columns
          const sanitizedColumns = index.columns.map(col => 
            sanitizeSqlIdentifier(col, 'column name')
          ).join(', ');
          
          // Validate index method if provided
          let indexMethod = '';
          if (index.method) {
            const validMethods = ['btree', 'hash', 'gist', 'gin', 'spgist', 'brin'];
            if (validMethods.includes(index.method.toLowerCase())) {
              indexMethod = `USING ${index.method.toLowerCase()}`;
            }
          }
          
          // Create the index
          const createIndexQuery = `
            CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${indexName}
            ON ${sanitizedTableName} ${indexMethod}
            (${sanitizedColumns})
          `;
          
          await sequelize.query(createIndexQuery, { transaction });
        }
      }
      
      // Commit transaction
      await transaction.commit();
      
      logger.info(`Table '${tableName}' created successfully`);
      
      res.status(201).json({
        success: true,
        message: `Table '${tableName}' created successfully`,
        table: {
          name: tableName,
          columns: columns.map(c => c.name),
          indexes: indexes.map(i => i.name || `${tableName}_${i.columns.join('_')}_idx`)
        }
      });
    } catch (error) {
      // Rollback transaction on error
      await transaction.rollback();
      logger.error(`Error creating table '${tableName}':`, error);
      throw error;
    }
  } catch (error) {
    res.status(500);
    throw new Error(`Failed to create table: ${error.message}`);
  }
});

/**
 * Create a predefined table from a template with enhanced security
 * @route POST /api/admin/schema/templates/:templateName
 */
const createTableFromTemplate = asyncHandler(async (req, res) => {
  const { templateName } = req.params;
  
  // Validate template name (prevent path traversal)
  if (!/^[a-zA-Z0-9_-]+$/.test(templateName)) {
    res.status(400);
    throw new Error('Invalid template name');
  }
  
  try {
    // Look for template in templates directory
    const templatesDir = path.join(__dirname, '../templates');
    const templateFile = path.join(templatesDir, `${templateName}.sql`);
    
    // Prevent path traversal by comparing resolved paths
    const resolvedTemplatePath = path.resolve(templateFile);
    const resolvedTemplatesDir = path.resolve(templatesDir);
    
    if (!resolvedTemplatePath.startsWith(resolvedTemplatesDir)) {
      res.status(403);
      throw new Error('Template access forbidden');
    }
    
    // Try to read the template file
    let sql;
    try {
      sql = await fs.readFile(templateFile, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') {
        res.status(404);
        throw new Error(`Template '${templateName}' not found`);
      }
      throw err;
    }
    
    // Validate SQL content for safety
    if (!validateSqlContent(sql)) {
      res.status(400);
      throw new Error('Template contains potentially unsafe SQL operations');
    }
    
    // Start a transaction
    const transaction = await sequelize.transaction();
    
    try {
      // Execute the SQL template
      await sequelize.query(sql, { transaction });
      
      // Verify we can query the created table (if it's a CREATE TABLE statement)
      // This helps validate the template executed successfully
      const tableMatch = sql.match(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-zA-Z0-9_"]+)/i);
      if (tableMatch && tableMatch[1]) {
        // Remove any quotes from the table name
        const tableName = tableMatch[1].replace(/['"]/g, '');
        
        // Check if the table exists and is accessible
        const tableExists = await sequelize.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = :tableName
          )
        `, { 
          replacements: { tableName },
          type: sequelize.QueryTypes.SELECT,
          transaction
        });
        
        if (!tableExists[0].exists) {
          // Table doesn't exist after executing the template
          await transaction.rollback();
          res.status(500);
          throw new Error(`Template execution failed: Table '${tableName}' was not created`);
        }
      }
      
      // Commit transaction
      await transaction.commit();
      
      logger.info(`Template '${templateName}' executed successfully`);
      
      res.status(201).json({
        success: true,
        message: `Template '${templateName}' executed successfully`,
        templateName
      });
    } catch (error) {
      // Rollback transaction on error
      await transaction.rollback();
      logger.error(`Error executing template '${templateName}':`, error);
      
      res.status(500);
      throw new Error(`Failed to execute template: ${error.message}`);
    }
  } catch (error) {
    // Catch any errors not caught in inner try/catch
    if (!res.statusCode || res.statusCode === 200) {
      res.status(500);
    }
    throw new Error(`Failed to execute template: ${error.message}`);
  }
});

/**
 * Get schema details for a specific table
 * @route GET /api/admin/schema/tables/:tableName
 */
const getTableSchema = asyncHandler(async (req, res) => {
  const { tableName } = req.params;
  
  // Validate table name
  if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
    res.status(400);
    throw new Error('Invalid table name');
  }
  
  try {
    // Check if table exists - using parameterized query
    const tableExists = await sequelize.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = :tableName
      )
    `, { 
      replacements: { tableName },
      type: sequelize.QueryTypes.SELECT
    });
    
    if (!tableExists[0].exists) {
      res.status(404);
      throw new Error(`Table '${tableName}' not found`);
    }
    
    // Get column information - using parameterized query
    const columns = await sequelize.query(`
      SELECT 
        column_name, 
        data_type, 
        column_default, 
        is_nullable,
        character_maximum_length
      FROM 
        information_schema.columns 
      WHERE 
        table_schema = 'public' AND table_name = :tableName
      ORDER BY 
        ordinal_position
    `, { 
      replacements: { tableName },
      type: sequelize.QueryTypes.SELECT
    });
    
    // Get constraint information - using parameterized query
    const constraints = await sequelize.query(`
      SELECT 
        tc.constraint_name,
        tc.constraint_type,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM 
        information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        LEFT JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
      WHERE 
        tc.table_schema = 'public' AND tc.table_name = :tableName
      ORDER BY 
        tc.constraint_name, kcu.column_name
    `, { 
      replacements: { tableName },
      type: sequelize.QueryTypes.SELECT
    });
    
    // Get index information - using parameterized query
    const indexes = await sequelize.query(`
      SELECT
        indexname as index_name,
        indexdef as index_definition
      FROM
        pg_indexes
      WHERE
        schemaname = 'public' AND tablename = :tableName
    `, { 
      replacements: { tableName },
      type: sequelize.QueryTypes.SELECT
    });
    
    res.json({
      success: true,
      table: {
        name: tableName,
        columns,
        constraints,
        indexes
      }
    });
  } catch (error) {
    if (error.message.includes('not found')) {
      res.status(404);
    } else {
      res.status(500);
    }
    throw new Error(`Failed to get table schema: ${error.message}`);
  }
});

module.exports = {
  getDatabaseInfo,
  createTable,
  createTableFromTemplate,
  getTableSchema
};