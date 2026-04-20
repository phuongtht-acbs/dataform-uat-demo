// includes/func.js

/**
 * Standardizes common "junk" strings to true NULL values.
 * Useful for Silver-Staging cleanup of fields like 'N/A' or 'NULL'.
 */
function clean_null_string(col) {
  const null_string = ["'NULL'", "'N/A'", "'NA'", "'#N/A'", "''"];
  return `CASE WHEN TRIM(CAST(${col} AS STRING)) IN (${null_string.join(", ")}) THEN NULL ELSE ${col} END`;
}

/**
 * Parses a string/int into a date while nullifying one or many dummy values.
 * Defaults to common legacy dummy dates if none are provided.
 */
function parse_date(col, dummies = ['19000101', '00010101', '99991231']) {
  // Ensure dummies is always an array
  const dummyArray = Array.isArray(dummies) ? dummies : [dummies];
  
  // Format them for SQL: ['19000101'] -> "'19000101'"
  const formattedDummies = dummyArray.map(d => `'${d}'`).join(", ");

  return `SAFE.PARSE_DATE('%Y%m%d', CASE 
            WHEN CAST(${col} AS STRING) IN (${formattedDummies}) THEN NULL 
            ELSE CAST(${col} AS STRING) 
          END)`;
}

module.exports = { 
    clean_null_string, 
    parse_date 
};