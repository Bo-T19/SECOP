const express = require('express');
const dotenv = require('dotenv');
const axios = require('axios');

// Load environment variables
dotenv.config();
const BASE_URL = process.env.BASE_URL;
const API_KEY = process.env.API_KEY;

// Create the Express app
const app = express();

// Base filters for SECOP data queries
const filtrosBase = [
  `adjudicado = 'No'`,                                    // Not awarded yet
  `precio_base > 500000000`,                              // Base price > 500M COP
  `modalidad_de_contratacion != 'Contratación directa'`,  // Not direct contracting
  `codigo_principal_de_categoria LIKE '%811015%'`         // Category code for design services
];

// Reduced field set for AI analysis
const camposReducidos = [
  "id_del_proceso",
  "entidad",
  "departamento_entidad",
  "descripci_n_del_procedimiento",
  "fecha_de_publicacion_del",
  "estado_del_procedimiento",
  "adjudicado",
  "fecha_adjudicacion",
  "precio_base",
  "urlproceso"
];

// Complete field set for filtered queries
const camposFiltrados = [
  "id_del_proceso",
  "entidad",
  "departamento_entidad",
  "descripci_n_del_procedimiento",
  "estado_del_procedimiento",
  "adjudicado",
  "fecha_adjudicacion",
  "precio_base",
  "urlproceso",
  "unidad_de_duracion",
  "fase",
  "fecha_de_publicacion_del",
  "fecha_de_ultima_publicaci",
  "fecha_de_publicacion_fase",
  "fecha_de_publicacion_fase_1",
  "fecha_de_publicacion_fase_2",
  "fecha_de_publicacion_fase_3",
  "fecha_de_recepcion_de",
  "fecha_de_apertura_de_respuesta",
  "fecha_de_apertura_efectiva"
];

/**
 * Calculate the previous business day
 * - If today is Monday, go back to Friday (3 days)
 * - If today is Sunday, go back to Friday (2 days)
 * - Otherwise, go back 1 day
 * @returns {string} Date in YYYY-MM-DD format
 */
function getPreviousBusinessDay() {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  
  let daysBack = 1;
  if (dayOfWeek === 1) daysBack = 3; // Monday -> Friday
  if (dayOfWeek === 0) daysBack = 2; // Sunday -> Friday
  
  const previousDay = new Date(today);
  previousDay.setDate(today.getDate() - daysBack);
  
  const yyyy = previousDay.getFullYear();
  const mm = String(previousDay.getMonth() + 1).padStart(2, '0');
  const dd = String(previousDay.getDate()).padStart(2, '0');
  
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Validate date format (YYYY-MM-DD)
 * @param {string} dateString - Date string to validate
 * @returns {boolean} True if valid format
 */
function isValidDateFormat(dateString) {
  const regex = /^\d{4}-\d{2}-\d{2}$/;
  if (!regex.test(dateString)) return false;
  
  const date = new Date(dateString);
  return date instanceof Date && !isNaN(date);
}

/**
 * Fetch SECOP data from the API
 * @param {array} campos - Fields to select
 * @param {string} fecha - Date filter (YYYY-MM-DD format)
 * @returns {array} SECOP data array
 */
async function getSECOPData(campos, fecha) {
  // Use previous business day if no date provided
  const targetDate = fecha || getPreviousBusinessDay();
  const formattedDate = `${targetDate}T00:00:00.000`;
  
  // Build filters array
  const filtros = [...filtrosBase];
  filtros.push(`fecha_de_publicacion_del >= '${formattedDate}'`);

  // API parameters
  const params = {
    '$where': filtros.join(' AND '),
    '$select': campos.length > 0 ? campos.join(',') : '*', // Use all fields if empty array
    '$order': 'precio_base DESC',
    '$limit': 1000,
    '$offset': 0
  };

  try {
    const res = await axios.get(BASE_URL, { params });
    return res.data;
  } catch (err) {
    console.error('Error fetching SECOP data:', err.message);
    return [];
  }
}

/**
 * Analyze SECOP data using ChatGPT API
 * @param {array} data - SECOP data to analyze
 * @returns {object} AI analysis result
 */
async function analyseDataWithAI(data) {
  const chatGPTUrl = "https://api.openai.com/v1/chat/completions";

  const headers = {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
  };

  const system_msg = `
You are an expert in government contracting in Colombia with updated knowledge 
about process types and legal requirements. You will receive a JSON response 
containing information about contracting processes extracted from SECOP.

Evaluate each process and tell us which ones are relevant for Double C Designs, 
a company specialized in building and infrastructure design.
Please note, this is design only, not construction.

Respond in JSON format indicating the process ID (if available), followed by 
the description, url, price, entity and justification. If there are no 
processes of interest, respond:

"Today I haven't found any processes that might interest you in SECOP"

Do not include the response in code blocks (without \`\`\`json or \`\`\`).
`;

  const payload = {
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: system_msg },
      { role: 'user', content: JSON.stringify(data, null, 2) }
    ],
    temperature: 0
  };

  try {
    const response = await axios.post(chatGPTUrl, payload, { headers });
    const content = response.data.choices?.[0]?.message?.content;
    
    if (!content) {
      return { error: "No valid response received from ChatGPT" };
    }
    
    // Clean response by removing code block markers
    const cleanResponse = content.replace(/```json\n?/, '').replace(/```$/, '').trim();
    
    // Validate JSON parsing
    try {
      return JSON.parse(cleanResponse);
    } catch (parseError) {
      console.error('JSON parsing error:', parseError);
      return { 
        error: "ChatGPT response doesn't contain valid JSON", 
        raw: cleanResponse 
      };
    }
    
  } catch (err) {
    console.error('Error analyzing data with ChatGPT:', err.message);
    return { error: 'Error communicating with ChatGPT' };
  }
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * Home page with API documentation
 */
app.get('/', async (req, res) => {
  res.send(`
    <html>
      <head>
        <title>SECOP II API</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 40px;
            background-color: #f5f5f5;
          }
          .container {
            max-width: 800px;
            margin: 0 auto;
            background: white;
            padding: 30px;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          h1 {
            color: #333;
            border-bottom: 2px solid #007BFF;
            padding-bottom: 10px;
          }
          ul {
            list-style-type: none;
            padding: 0;
          }
          li {
            margin: 15px 0;
            padding: 15px;
            border: 1px solid #ddd;
            border-radius: 5px;
            background-color: #fafafa;
          }
          a {
            text-decoration: none;
            color: #007BFF;
            font-weight: bold;
            font-size: 1.1em;
          }
          a:hover {
            text-decoration: underline;
          }
          .description {
            font-size: 0.9em;
            color: #555;
            margin: 8px 0;
          }
          .example {
            font-size: 0.8em;
            color: #888;
            font-style: italic;
            background: #f0f0f0;
            padding: 5px;
            border-radius: 3px;
            margin-top: 5px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Welcome to SECOP II API</h1>
          <p>Select one of the available endpoints:</p>
          <ul>
            <li>
              <a href="/raw">/raw</a>
              <div class="description">Gets all SECOP data according to applied filters, without limiting to specific fields.</div>
              <div class="example">Examples: /raw or /raw?fecha=2025-04-18</div>
            </li>
            <li>
              <a href="/filtered">/filtered</a>
              <div class="description">Gets SECOP data with selected fields (suggested by Andrés González), such as entity, description, price, etc.</div>
              <div class="example">Examples: /filtered or /filtered?fecha=2025-04-18</div>
            </li>
            <li>
              <a href="/analyzed">/analyzed</a>
              <div class="description">Sends data to ChatGPT to analyze which processes are relevant for Double C Designs and returns a filtered JSON response.</div>
              <div class="example">Examples: /analyzed or /analyzed?fecha=2025-04-18</div>
            </li>
          </ul>
          <p><strong>Note:</strong> Date parameter is optional. If not provided, it will use the previous business day.</p>
        </div>
      </body>
    </html>
  `);
});

/**
 * Raw endpoint - Returns all SECOP data with all available fields
 * Optional query parameter: fecha (YYYY-MM-DD format)
 */
app.get('/raw', async (req, res) => {
  try {
    let fecha = req.query.fecha;
    
    // Validate date format if provided
    if (fecha && !isValidDateFormat(fecha)) {
      return res.status(400).json({ 
        error: 'Invalid date format. Use YYYY-MM-DD' 
      });
    }
    
    const datos = await getSECOPData([], fecha); // Empty array means all fields
    res.json({
      date_used: fecha || getPreviousBusinessDay(),
      total_records: datos.length,
      data: datos
    });

  } catch (err) {
    console.error('General error in /raw:', err.message);
    res.status(500).json({ error: 'Error processing data' });
  }
});

/**
 * Filtered endpoint - Returns SECOP data with selected fields only
 * Optional query parameter: fecha (YYYY-MM-DD format)
 */
app.get('/filtered', async (req, res) => {
  try {
    let fecha = req.query.fecha;
    
    // Validate date format if provided
    if (fecha && !isValidDateFormat(fecha)) {
      return res.status(400).json({ 
        error: 'Invalid date format. Use YYYY-MM-DD' 
      });
    }
    
    const datos = await getSECOPData(camposFiltrados, fecha);
    res.json({
      date_used: fecha || getPreviousBusinessDay(),
      total_records: datos.length,
      data: datos
    });

  } catch (err) {
    console.error('General error in /filtered:', err.message);
    res.status(500).json({ error: 'Error processing data' });
  }
});

/**
 * Analyzed endpoint - Returns SECOP data analyzed by ChatGPT
 * Optional query parameter: fecha (YYYY-MM-DD format)
 */
app.get('/analyzed', async (req, res) => {
  try {
    let fecha = req.query.fecha;
    
    // Validate date format if provided
    if (fecha && !isValidDateFormat(fecha)) {
      return res.status(400).json({ 
        error: 'Invalid date format. Use YYYY-MM-DD' 
      });
    }
    
    const datos = await getSECOPData(camposReducidos, fecha);
    const evaluacion = await analyseDataWithAI(datos);
    
    res.json({
      date_used: fecha || getPreviousBusinessDay(),
      total_records_analyzed: datos.length,
      ai_analysis: evaluacion
    });
    
  } catch (err) {
    console.error('General error in /analyzed:', err.message);
    res.status(500).json({ error: 'Error processing data' });
  }
});

// ============================================================================
// SERVER STARTUP
// ============================================================================

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log(`  - GET /raw[?fecha=YYYY-MM-DD]`);
  console.log(`  - GET /filtered[?fecha=YYYY-MM-DD]`);
  console.log(`  - GET /analyzed[?fecha=YYYY-MM-DD]`);
});

// ============================================================================
// ERROR HANDLING
// ============================================================================

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  console.error('Unhandled Promise Rejection:', err);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});