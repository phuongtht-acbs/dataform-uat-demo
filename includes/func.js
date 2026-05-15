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
 * Nullifies dummy dates when the input column is already a DATE type.
 * Converts YYYYMMDD inputs to DATE 'YYYY-MM-DD' literals.
 */
function cleanNullDate(col, dummies = ['19000101', '00010101', '99991231']) {
  const dummyArray = Array.isArray(dummies) ? dummies : [dummies];
  
  // Convert '19000101' -> "DATE '1900-01-01'"
  const formattedDummies = dummyArray.map(d => {
    const s = String(d);
    const iso = `${s.substring(0, 4)}-${s.substring(4, 6)}-${s.substring(6, 8)}`;
    return `DATE '${iso}'`;
  }).join(", ");

  return `CASE 
            WHEN ${col} IN (${formattedDummies}) THEN NULL 
            ELSE ${col} 
          END`;
}
/**
 * Parses raw numeric/string data into a DATE, then cleans dummy values.
 */
function parseNumericDate(col, dummies = ['19000101', '00010101', '99991231']) {
  const dateExpr = `SAFE.PARSE_DATE('%Y%m%d', CAST(${col} AS STRING))`;
  return cleanNullDate(dateExpr, dummies);
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
    AND ${dateCol} >= DATE(${alias}.valid_from)
    AND (${alias}.valid_to IS NULL OR ${dateCol} < DATE(${alias}.valid_to))`;
}

/**
 * Standardizes SCD2 expiration merge logic for Gold history tables.
 * @param {string} targetTable - result of self()
 * @param {string} naturalKey - The business identifier (e.g., 'sub_acco_no')
 * @param {string} stagingQuery - The SQL string for the denormalized data
 */
function expireHistory(targetTable, naturalKey, stagingQuery) {
  return `
    MERGE ${targetTable} AS t
    USING (${stagingQuery}) AS s
    ON t.${naturalKey} = s.${naturalKey} 
    AND t.is_current = true 
    AND t.record_hash != s.record_hash
    WHEN MATCHED THEN
      UPDATE SET
        t._updated_at = run_time,
        t.valid_to = CAST(target_date AS TIMESTAMP),
        t.is_current = false;
  `;
}

/**
 * Updates the bronze_checkpoint table with the latest date from a source.
 * @param {string} entryName - The table name key (e.g., 'CORTSUB_ACCOUNT').
 * @param {string} sourceRef - The ref() of the bronze source table.
 * @param {string} dateCol - The partition column name in bronze.
 */
function updateCheckpoint(entryName, sourceRef, dateCol, checkpointRef) {
  return `
    UPDATE ${checkpointRef}
    SET latest_date = (SELECT MAX(${dateCol}) FROM ${sourceRef}),
        _updated_at = CURRENT_TIMESTAMP()
    WHERE table_name = '${entryName}';
  `;
}

module.exports = { 
    cleanNullString, 
    cleanNullDate,
    parseNumericDate,
    generateHash,
    getCurrentDim,
    joinHistory,
    expireHistory,
    updateCheckpoint
};