const asyncHandler = require('express-async-handler');
const { sequelize } = require('../db/connection');
const logger = require('../utils/logger');
const fs = require('fs').promises;
const path = require('path');

/**
 * Get database health and schema information
 * @route GET /api/admin/schema
 */
const getDatabaseInfo = asyncHandler(async (req, res) => {
  // Use raw query to get table information
  const tables = await sequelize.query(`
    SELECT 
      table_name,
      (SELECT count(*) FROM information_schema.columns WHERE table_name = t.table_name) as column_count
    FROM 
      information_schema.tables t
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
 * Create a table based on JSON definition
 * @route POST /api/admin/schema/tables
 */
const createTable = asyncHandler(async (req, res) => {
  const { tableName, columns, indexes = [], constraints = [] } = req.body;
  
  // Validate required parameters
  if (!tableName || !columns || !Array.isArray(columns) || columns.length === 0) {
    res.status(400);
    throw new Error('Table name and at least one column are required');
  }
  
  // Check table name format (prevent SQL injection)
  if (!/^[a-zA-Z0-9_]+$/.test(tableName)) {
    res.status(400);
    throw new Error('Table name must contain only alphanumeric characters and underscores');
  }
  
  // Validate columns format
  const validateColumns = columns.every(col => 
    col.name && col.type && 
    /^[a-zA-Z0-9_]+$/.test(col.name) && 
    /^[a-zA-Z0-9_\(\)]+$/.test(col.type)
  );
  
  if (!validateColumns) {
    res.status(400);
    throw new Error('Invalid column format. Each column must have a valid name and type');
  }
  
  // Generate SQL for table creation
  try {
    // Start transaction
    const transaction = await sequelize.transaction();
    
    try {
      // Check if table exists
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
      
      // Build CREATE TABLE statement
      let createTableSQL = `CREATE TABLE ${tableName} (\n`;
      
      // Add columns
      const columnDefinitions = columns.map(col => {
        let colDef = `  "${col.name}" ${col.type}`;
        
        // Add constraints for the column
        if (col.primaryKey) colDef += ' PRIMARY KEY';
        if (col.unique) colDef += ' UNIQUE';
        if (col.notNull) colDef += ' NOT NULL';
        if (col.defaultValue !== undefined) {
          // Handle different default value types
          if (typeof col.defaultValue === 'string') {
            colDef += ` DEFAULT '${col.defaultValue}'`;
          } else if (col.defaultValue === null) {
            colDef += ' DEFAULT NULL';
          } else {
            colDef += ` DEFAULT ${col.defaultValue}`;
          }
        }
        
        return colDef;
      }).join(',\n');
      
      createTableSQL += columnDefinitions;
      
      // Add table-level constraints
      if (constraints && constraints.length > 0) {
        const constraintDefinitions = constraints.map(constraint => {
          if (constraint.type === 'PRIMARY KEY') {
            return `  PRIMARY KEY (${constraint.columns.map(c => `"${c}"`).join(', ')})`;
          } else if (constraint.type === 'UNIQUE') {
            return `  UNIQUE (${constraint.columns.map(c => `"${c}"`).join(', ')})`;
          } else if (constraint.type === 'CHECK') {
            return `  CHECK (${constraint.definition})`;
          } else if (constraint.type === 'FOREIGN KEY') {
            return `  FOREIGN KEY (${constraint.columns.map(c => `"${c}"`).join(', ')}) ` +
                   `REFERENCES ${constraint.references.table}(${constraint.references.columns.map(c => `"${c}"`).join(', ')})` +
                   (constraint.onDelete ? ` ON DELETE ${constraint.onDelete}` : '') +
                   (constraint.onUpdate ? ` ON UPDATE ${constraint.onUpdate}` : '');
          }
          return null;
        }).filter(Boolean).join(',\n');
        
        if (constraintDefinitions) {
          createTableSQL += ',\n' + constraintDefinitions;
        }
      }
      
      createTableSQL += '\n)';
      
      // Execute CREATE TABLE
      await sequelize.query(createTableSQL, { transaction });
      
      // Create indexes if provided
      if (indexes && indexes.length > 0) {
        for (const index of indexes) {
          if (!index.columns || !Array.isArray(index.columns) || index.columns.length === 0) {
            continue;
          }
          
          const indexName = index.name || `${tableName}_${index.columns.join('_')}_idx`;
          const unique = index.unique ? 'UNIQUE ' : '';
          const method = index.method ? `USING ${index.method} ` : '';
          
          const createIndexSQL = `CREATE ${unique}INDEX ${indexName} ON ${tableName} ${method}(${index.columns.map(c => `"${c}"`).join(', ')})`;
          await sequelize.query(createIndexSQL, { transaction });
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
    
    // Start a transaction
    const transaction = await sequelize.transaction();
    
    try {
      // Execute the SQL template
      await sequelize.query(sql, { transaction });
      
      // Verify we can query the created table (if it's a CREATE TABLE statement)
      // This helps validate the template executed successfully
      const tableMatch = sql.match(/CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+(\w+)/i);
      if (tableMatch && tableMatch[1]) {
        const tableName = tableMatch[1].replace(/['"]/g, ''); // Remove any quotes
        
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