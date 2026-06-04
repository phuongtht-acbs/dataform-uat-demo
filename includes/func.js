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
 * Standardizes Scd7 expiration merge logic for Gold history tables.
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

/**
 * Prepends a table alias prefix to an array of column projection strings.
 * Automatically accommodates standard SQL aliases written inside the text string.
 * @param {string[]} cols - Array of raw columns or "col AS alias" strings.
 * @param {string} alias - The table identifier prefix.
 */
function renderColumns(cols, alias) {
  return cols.map(c => `${alias}.${c}`).join(",\n    ");
}

/**
 * Renders columns for all history dimensions and safely appends a trailing comma only if not empty.
 */
function renderHistoryColumns(historyDimensions) {
  if (!historyDimensions || historyDimensions.length === 0) return "";
  
  return historyDimensions
    .map(d => d.columns.map(c => `${d.alias}.${c.trim()}`).join(",\n    "))
    .join(",\n    ") + ",";
}

/**
 * Renders columns for lookup attributes and safely appends a trailing comma only if not empty.
 */
function renderLookupColumns(lookupAttributes) {
  const keys = Object.keys(lookupAttributes || {});
  if (keys.length === 0) return "";
  return keys.map(col => `lkp_${col}.attribute_name AS ${col}_name`).join(",\n    ") + ",";
}

/**
 * Tạo tự động câu lệnh SQL để kiểm tra chất lượng dữ liệu SCD Type 2 cho các bảng Dimension.
 * @param {string} tableName - Tên bảng viết dưới dạng chuỗi để lưu vào log lỗi
 * @param {string} sourceRef - Kết quả của hàm ref("schema", "table")
 * @param {string} surrogateKey - Tên cột khóa chính lịch sử
 */
function checkScd7Dimension(tableName, sourceRef, surrogateKey) {
  return `
WITH source_data AS (
  SELECT * FROM ${sourceRef}
),

/* 1. Check is_current và valid_to is NULL */
check_is_current AS (
  SELECT 
    '${tableName}' AS table_name,
    ${surrogateKey} AS failed_key, 
    'is_current và valid_to không khớp' AS failed_rule 
  FROM source_data
  WHERE NOT (is_current = (valid_to IS NULL))
),

/* 2. Check valid_from có bé hơn valid_to không */
check_valid_from_valid_to AS (
  SELECT 
    '${tableName}' AS table_name,
    ${surrogateKey} AS failed_key, 
    'valid_from > valid_to' AS failed_rule 
  FROM source_data
  WHERE NOT (valid_to IS NULL OR valid_from < valid_to)
),

/* 3. Check khóa chính duy nhất không */
check_unique_key AS (
  SELECT 
    '${tableName}' AS table_name,
    ${surrogateKey} AS failed_key, 
    'Khóa chính không duy nhất' AS failed_rule 
  FROM source_data
  GROUP BY ${surrogateKey}
  HAVING COUNT(*) > 1
)

SELECT * FROM check_is_current
UNION ALL
SELECT * FROM check_valid_from_valid_to
UNION ALL
SELECT * FROM check_unique_key
  `;
}
/**
 * Prevents processing a target_date that is older than or equal to 
 * the maximum existing valid_from date in an Scd7 table.
 * @param {boolean} isIncremental - Result of Dataform's incremental() function
 * @param {string} selfRef - Result of Dataform's self() function
 */
function guardScd7Timeline(isIncremental, selfRef) {
  if (!isIncremental) return ""; // Pass safely during initial runs/full refreshes
  
return `
    SET current_max_valid_from = (SELECT MAX(DATE(valid_from)) FROM ${selfRef});

    IF target_date <= COALESCE(current_max_valid_from, DATE('1900-01-01')) THEN
      RAISE USING MESSAGE = CONCAT(
        "Vi phạm logic Scd7: target_date ngày (", 
        CAST(target_date AS STRING), 
        ") cần phải lớn hơn mốc thời gian max(valid_from) hiện tại của bảng (", 
        CAST(COALESCE(current_max_valid_from, DATE('1900-01-01')) AS STRING), 
        ")."
      );
    END IF;
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
    updateCheckpoint,
    renderColumns,
    renderHistoryColumns,
    renderLookupColumns,
    checkScd7Dimension,
    guardScd7Timeline
};