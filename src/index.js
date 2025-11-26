// npm i @azure/digital-twins-core @azure/identity

const { app } = require('@azure/functions');
const { DigitalTwinsClient } = require('@azure/digital-twins-core');
const { DefaultAzureCredential, ManagedIdentityCredential } = require('@azure/identity');
const crypto = require('crypto');

let dtClient; // reused across invocations

// ---------- Shared helpers ----------

function getCredential() {
  const isRunningInAzure =
    !!process.env.WEBSITE_INSTANCE_ID || !!process.env.FUNCTIONS_EXTENSION_VERSION;

  if (isRunningInAzure) {
    // In Azure Functions: use Managed Identity
    const msiClientId = process.env.AZURE_CLIENT_ID || process.env.MSI_CLIENT_ID;
    return msiClientId
      ? new ManagedIdentityCredential(msiClientId)
      : new ManagedIdentityCredential();
  }

  // Local dev: use DefaultAzureCredential (CLI/VS Code/env)
  return new DefaultAzureCredential();
}

function getDigitalTwinsClient(context) {
  if (!dtClient) {
    const adtUrl = process.env.ADT_URL;
    if (!adtUrl) {
      throw new Error(
        'Missing ADT_URL environment variable (e.g., https://<instance>.api.<region>.digitaltwins.azure.net)'
      );
    }
    dtClient = new DigitalTwinsClient(adtUrl, getCredential());
    context.log(`DigitalTwinsClient initialized for ${adtUrl}`);
  }
  return dtClient;
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    try {
      const text = await request.text();
      return text ? JSON.parse(text) : {};
    } catch {
      return {};
    }
  }
}

function toJsonPatchFromProperties(props = {}) {
  return Object.entries(props).map(([key, value]) => ({
    op: 'add',
    path: `/${key}`,
    value
  }));
}

function createMessageId() {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex');
}

async function safePublishTelemetry(client, digitalTwinId, telemetry, dtTimestamp, context, tag) {
  if (typeof digitalTwinId !== 'string' || !digitalTwinId) {
    throw new Error(`Invalid digitalTwinId for telemetry (${tag || 'no-tag'})`);
  }
  if (!telemetry || typeof telemetry !== 'object' || Array.isArray(telemetry)) {
    throw new Error(`Telemetry must be a non-array object for ${tag || 'no-tag'}`);
  }

  const messageId = createMessageId();
  const payload = telemetry;
  const options = dtTimestamp ? { dtTimestamp } : undefined;

  context.log('safePublishTelemetry', {
    tag,
    digitalTwinId,
    messageId,
    dtTimestamp,
    telemetryKeys: Object.keys(telemetry)
  });

  // JS SDK signature (v2.x): publishTelemetry(digitalTwinId, telemetryPayload, messageId, options?)
  return client.publishTelemetry(digitalTwinId, payload, String(messageId), options); //refer to line 141 comment 
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type, authorization'
};


async function handleOpenRemoteRulePayload(body, client, context) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return null;
  }

  const results = [];

  for (const [groupId, events] of Object.entries(body)) {
    if (!Array.isArray(events) || events.length === 0) continue;

    const withAsset = events.find(e => e && e.assetName);
    if (!withAsset || !withAsset.assetName) continue;

    // Map OpenRemote assetName -> ADT digitalTwinId
    const digitalTwinId = withAsset.assetName; 

    const telemetry = {};
    let latestTs = null;

    for (const ev of events) {
      if (!ev || typeof ev !== 'object') continue;

      const attrName = ev.ref && ev.ref.name;
      const hasValue = Object.prototype.hasOwnProperty.call(ev, 'value');
      if (!attrName || !hasValue) continue;

      telemetry[attrName] = ev.value;

      if (typeof ev.timestamp === 'number') {
        const d = new Date(ev.timestamp);
        if (!isNaN(d) && (!latestTs || d > latestTs)) {
          latestTs = d;
        }
      }
    }

    const keys = Object.keys(telemetry);
    if (keys.length === 0) continue;

    const dtTimestamp = (latestTs || new Date()).toISOString();

    // 1) Send telemetry, this does not update the JSON of the digital twin, so no updation on the digital twin UI
    await safePublishTelemetry(
      client,
      digitalTwinId,
      telemetry,
      dtTimestamp,
      context,
      `openremote:${groupId}`
    );

    // 2) update twin state with latest values fir live vals
    const patch = toJsonPatchFromProperties(telemetry);
    await client.updateDigitalTwin(digitalTwinId, patch);

    results.push({
      groupId,
      digitalTwinId,
      dtTimestamp,
      attributes: keys
    });
  }

  if (results.length === 0) return null;

  return {
    status: 200,
    headers: corsHeaders,
    jsonBody: {
      ok: true,
      action: 'publishTelemetry+updateTwin:openremoteRulePayload',
      results
    }
  };
}

async function handleTriggerAssetsPayload(body, client, context) {
  const assets = Array.isArray(body)
    ? body
    : Array.isArray(body.assets)
    ? body.assets
    : null;

  if (!assets) return null;

  const results = [];

  for (const asset of assets) {
    if (!asset || !asset.id || !asset.attributes) continue;

    const digitalTwinId = asset.id; 
    const telemetry = {};
    let latestTs = null;

    for (const [attrName, attrObj] of Object.entries(asset.attributes)) {
      if (!attrObj || typeof attrObj.value === 'undefined') continue;

      telemetry[attrName] = attrObj.value;

      const ts = attrObj.timestamp || attrObj.time;
      if (ts) {
        const d = new Date(ts);
        if (!isNaN(d) && (!latestTs || d > latestTs)) {
          latestTs = d;
        }
      }
    }

    const keys = Object.keys(telemetry);
    if (keys.length === 0) continue;

    const dtTimestamp = (latestTs || new Date()).toISOString();

    // 1) Send telemetry
    await safePublishTelemetry(
      client,
      digitalTwinId,
      telemetry,
      dtTimestamp,
      context,
      'triggerAssets'
    );

    // 2) Update twin state with latest values
    const patch = toJsonPatchFromProperties(telemetry);
    await client.updateDigitalTwin(digitalTwinId, patch);

    results.push({
      digitalTwinId,
      dtTimestamp,
      attributes: keys
    });
  }

  if (results.length === 0) return null;

  return {
    status: 200,
    headers: corsHeaders,
    jsonBody: {
      ok: true,
      action: 'publishTelemetry+updateTwin:triggerAssets',
      results
    }
  };
}

// ---------- 3) Main HTTP trigger ----------

app.http('httpTrigger1', {
  methods: ['POST', 'OPTIONS'],
  authLevel: 'anonymous',
  route: 'ingest',
  handler: async (request, context) => {
    if (request.method === 'OPTIONS') {
      return { status: 204, headers: corsHeaders };
    }

    context.log(`HTTP webhook received: ${request.method} ${request.url}`);

    const body = await readBody(request);
    const client = getDigitalTwinsClient(context);

    // 1) Try OpenRemote rule-engine format
    try {
      const orResult = await handleOpenRemoteRulePayload(body, client, context);
      if (orResult) return orResult;
    } catch (err) {
      const restDetails = {
        name: err.name,
        message: err.message,
        code: err.code,
        statusCode: err.statusCode,
        body: err.response && (err.response.bodyAsText || err.response.body),
        stack: err.stack
      };

      context.log('Error handling OpenRemote rule payload', restDetails);

      return {
        status: 502,
        headers: corsHeaders,
        jsonBody: {
          error: 'Failed to process OpenRemote rule payload',
          details: restDetails
        }
      };
    }

    // 2) Try %TRIGGER_ASSETS% format
    try {
      const triggerAssetsResult = await handleTriggerAssetsPayload(
        body,
        client,
        context
      );
      if (triggerAssetsResult) return triggerAssetsResult;
    } catch (err) {
      context.log('Error handling TRIGGER_ASSETS payload', err);
      return {
        status: 502,
        headers: corsHeaders,
        jsonBody: {
          error: 'Failed to process TRIGGER_ASSETS payload',
          details: err.message || String(err)
        }
      };
    }

    // 3) Fallback: digitalTwinId + patch/properties/telemetry format

    const url = new URL(request.url);
    const q = url.searchParams;
    const digitalTwinId =
      q.get('digitalTwinId') || //determining twinid name based on OR telemetry which MIGHT differ
      body.digitalTwinId ||
      body.assetName || 
      body.twin_id ||
      body.deviceId;

    if (!digitalTwinId) {
      return {
        status: 400,
        headers: corsHeaders,
        jsonBody: {
          error:
            'Missing digitalTwinId. Provide ?digitalTwinId=... or include digitalTwinId/assetName in the JSON body.'
        }
      };
    }

    const hasExplicitPatch = Array.isArray(body.patch);
    const hasProperties =
      body.properties && typeof body.properties === 'object';

    const hasTelemetryShape =
      (body.telemetry && typeof body.telemetry === 'object') ||
      (typeof body.attributeName === 'string' &&
        Object.prototype.hasOwnProperty.call(body, 'value'));

    try {
      // 3a) Raw patch
      if (hasExplicitPatch) {
        await client.updateDigitalTwin(digitalTwinId, body.patch);
        return {
          status: 200,
          headers: corsHeaders,
          jsonBody: {
            ok: true,
            action: 'updateDigitalTwin',
            digitalTwinId,
            ops: body.patch.length
          }
        };
      }

      // 3b) Properties -> patch
      if (hasProperties) {
        const patch = toJsonPatchFromProperties(body.properties);
        await client.updateDigitalTwin(digitalTwinId, patch);
        return {
          status: 200,
          headers: corsHeaders,
          jsonBody: {
            ok: true,
            action: 'updateProperties',
            digitalTwinId,
            properties: Object.keys(body.properties)
          }
        };
      }

      // 3c) Telemetry + state fallback 

      let Payload;
      if (
        typeof body.attributeName === 'string' &&
        Object.prototype.hasOwnProperty.call(body, 'value')
      ) {
        Payload = { [body.attributeName]: body.value };
      } else if (body.telemetry && typeof body.telemetry === 'object') {
        Payload = body.telemetry;
      } else if (hasTelemetryShape && body && typeof body === 'object' && !Array.isArray(body)) {
        Payload = body;
      } else if (body && typeof body === 'object' && !Array.isArray(body)) {
        // if no specific telemetry shape but still an object, treat as telemetry
        Payload = body;
      } else {
        throw new Error('Telemetry payload must be a non-array JSON object');
      }

      const dtTimestamp =
        body.timestamp ||
        body.time ||
        (body.telemetry && body.telemetry.timestamp) ||
        new Date().toISOString();

      // 1) Send telemetry
      await safePublishTelemetry(
        client,
        digitalTwinId,
        Payload,
        dtTimestamp,
        context,
        'fallback'
      );

      // 2) Update twin properties with same data
      const patch = toJsonPatchFromProperties(Payload);
      await client.updateDigitalTwin(digitalTwinId, patch);

      return {
        status: 200,
        headers: corsHeaders,
        jsonBody: {
          ok: true,
          action: 'publishTelemetry+updateTwin:fallback',
          digitalTwinId,
          dtTimestamp,
          fields: Object.keys(Payload || {})
        }
      };
    } catch (err) {
      context.log('ADT forwarding failed', err);
      return {
        status: 502,
        headers: corsHeaders,
        jsonBody: {
          error: 'Failed to forward to Azure Digital Twins',
          details: err.message || String(err)
        }
      };
    }
  }
});
