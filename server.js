const express = require('express');
const dotenv = require('dotenv');
const axios = require('axios');

// Load environment variables
dotenv.config();
const BASE_URL = process.env.BASE_URL;
const API_KEY = process.env.API_KEY;

// Create the Express app
const app = express();

//Function that fetches SECOP Data
const ayer = new Date();
ayer.setDate(ayer.getDate() - 1);

const yyyy = ayer.getFullYear();
const mm = String(ayer.getMonth() + 1).padStart(2, '0');
const dd = String(ayer.getDate()).padStart(2, '0');

const fechaFormateada = `${yyyy}-${mm}-${dd}T00:00:00.000`;

const filtros = [
  `fecha_de_publicacion_del >= '${fechaFormateada}'`,
  `adjudicado = 'No'`,
  `precio_base > 500000000`,
  `modalidad_de_contratacion != 'Contratación directa'`,
  `codigo_principal_de_categoria LIKE '%811015%'`
];

const campos = [
  "id_del_proceso",
  "entidad",
  "descripci_n_del_procedimiento",
  "fecha_de_publicacion_del",
  "precio_base",
  "urlproceso"
];

async function getSECOPData() {
  const params = {
    '$where': filtros.join(' AND '),
    '$select': campos.join(','),
    '$order': 'precio_base DESC',
    '$limit': 1000,
    '$offset': 0
  };

  try {
    const res = await axios.get(BASE_URL, { params });
    return res.data;
  } catch (err) {
    console.error('Error al obtener los datos:', err.message);
    return [];
  }
}

//Function that analyses the SECOP data by sending it to ChatGPT
async function analyseDataWithAI(data) {
  const chatGPTUrl = "https://api.openai.com/v1/chat/completions";

  const headers = {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
  };

  const system_msg = `
Eres un experto en contratación estatal en Colombia con conocimiento actualizado 
sobre los tipos de procesos y requisitos legales. A continuación recibirás una respuesta 
en formato JSON que contiene información sobre procesos de contratación extraídos del SECOP.

Evalúa cada proceso y dinos cuáles son relevantes para la empresa Double C Designs, 
especializada en diseño de edificaciones e infraestructura.
Por favor, solo es diseño, no es construcción.

Responde en formato de JSON indicando el ID del proceso (si está disponible), seguido de 
la descripción, la url, el precio, la entidad y la justificación. Si no hay ningún proceso
de interés responde: 

"Hoy no he encontrado procesos que te puedan interesar en el SECOP"

No incluyas la respuesta en bloques de código (sin \`\`\`json ni \`\`\`).
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
    const jsonData = response.data.choices?.[0]?.message?.content || 'Respuesta no esperada de ChatGPT';
    const cleanResponse = jsonData.replace(/```json\n?/, '').replace(/```$/, '').trim();
    return JSON.parse(cleanResponse);

  } catch (err) {
    console.error('Error al analizar los datos con ChatGPT:', err.message);
    return 'Error al comunicarse con ChatGPT';
  }
}

app.get('/', async (req, res) => {
  try {
    const datos = await getSECOPData();
    const evaluacion = await analyseDataWithAI(datos);
    res.json(evaluacion);
  } catch (err) {
    console.error('Error general:', err.message);
    res.status(500).send('Error procesando los datos');
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Servidor en puerto http://localhost:${PORT}`);
});
