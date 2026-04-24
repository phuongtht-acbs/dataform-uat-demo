// includes/func.js

/**
 * Standardizes common "junk" strings to true NULL values.
 * Useful for Silver-Staging cleanup of fields like 'N/A' or 'NULL'.
 */
function cleanNullString(col) {
  const nullString = ["'NULL'", "'N/A'", "'NA'", "'#N/A'", "''"];
  return `CASE WHEN TRIM(CAST(${col} AS STRING)) IN (${nullString.join(", ")}) THEN NULL ELSE ${col} END`;
}

/**
 * Parses a string/int into a date while nullifying one or many dummy values.
 * Defaults to common legacy dummy dates if none are provided.
 */
function parseDate(col, dummies = ['19000101', '00010101', '99991231']) {
  // Ensure dummies is always an array
  const dummyArray = Array.isArray(dummies) ? dummies : [dummies];
  
  // Format them for SQL: ['19000101'] -> "'19000101'"
  const formattedDummies = dummyArray.map(d => `'${d}'`).join(", ");

  return `SAFE.PARSE_DATE('%Y%m%d', CASE 
            WHEN CAST(${col} AS STRING) IN (${formattedDummies}) THEN NULL 
            ELSE CAST(${col} AS STRING) 
          END)`;
}

/**
 * Generates a SHA256 hash from a list of fields.
 * Useful for creating Surrogate Keys.
 * @param {string[]} fields - Array of column names to be hashed.
 */
function generateHash(fields) {
  // Joins the array into a comma-separated string for the STRUCT
  const fieldList = fields.join(", ");
  return `SHA256(TO_JSON_STRING(STRUCT(${fieldList})))`;
}

/**
 * Generates the current_dim CTE logic.
 * @param {boolean} isIncremental - Result of incremental()
 * @param {string} selfRef - Result of self()
 * @param {Object[]} columns - Array of {name: string, type: string}
 */
function getCurrentDim(isIncremental, selfRef, columns) {
  if (isIncremental) {
    // Return standard selection from current table
    const colList = columns.map(c => c.name).join(", ");
    return `SELECT ${colList} FROM ${selfRef} WHERE is_current`;
  }

  // Return the dummy "empty" schema for the first run
  const dummyCols = columns.map(c => {
    // We assume is_current is handled separately or included in columns
    return `CAST(NULL AS ${c.type}) AS ${c.name}`;
  }).join(",\n                ");

  return `(SELECT TRUE AS is_current, ${dummyCols} FROM (SELECT 1) WHERE 1=0)`;
}

/**
 * Standardizes temporal joins for SCD Type 2 history tables.
 * @param {string} tableRef - The result of ref() for the target table.
 * @param {string} alias - The alias for the joined table.
 * @param {string} leftKey - The join key from the source (e.g., 'f.cust_no').
 * @param {string} rightKey - The join key from the history table (e.g., 'cust_no').
 * @param {string} dateCol - The date column to compare against valid_from/to.
 */
function joinHistory(tableRef, alias, leftKey, rightKey, dateCol) {
  return `LEFT JOIN ${tableRef} AS ${alias}
    ON ${leftKey} = ${alias}.${rightKey}
    AND f.${dateCol} >= DATE(${alias}.valid_from)
    AND (${alias}.valid_to IS NULL OR f.${dateCol} < DATE(${alias}.valid_to))`;
}

module.exports = { 
    cleanNullString, 
    parseDate,
    generateHash,
    getCurrentDim,
    joinHistory
};