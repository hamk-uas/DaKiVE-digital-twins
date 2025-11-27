process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { app } = require('@azure/functions');
const { DecodeElsysPayload } = require('./decoder_hex.js');
const { hexToBytes } = require('./decoder_hex.js');
const { checkAndCreateAsset, fetchDataAndSearch,getAuthToken, generateAssetData, createAsset, assetData } = require('./checkAsset.js');
const https = require('https');
const httpsAgent = new https.Agent({
    rejectUnauthorized: false // Optional: skip certificate validation (use with caution)
  });
app.http('httpTrigger1', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        context.log(`Http function processed request for url "${request.url}"`);
        
        try {
            // Parse request payload
            const payloadData = await request.json();

            // Validate payload
            if (!payloadData || !payloadData.DevEUI_uplink || !payloadData.DevEUI_uplink.payload_hex) {
                return { status: 400, body: "Invalid payload: 'payload_hex' is missing" };
            }

            const hexVal = payloadData.DevEUI_uplink.payload_hex;
            const devEUI = payloadData.DevEUI_uplink.DevEUI;

            // Decode the payload
            const data = DecodeElsysPayload(hexToBytes(hexVal));

            // Check if the asset (sensor) exists, create if not
            const assetExists = await checkAndCreateAsset(devEUI, assetData);
            if (assetExists.exists) {
                context.log(`Asset for DevEUI ${devEUI} already exists.`);
                
            } else {
                context.log(`Asset for DevEUI ${devEUI} was created.`);
            }


            // Log decoded data
            context.log("Decoded Data:", data);
            
            const AssetID = assetExists.assetId;
            console.log("Asset ID is ", AssetID);

            const reqBodyPut = [
                { "ref": { "id": AssetID, "name": "Motion" }, "value": data.motion || null },
                { "ref": { "id": AssetID, "name": "Temperature" }, "value": data.temperature|| null },
                { "ref": { "id": AssetID, "name": "notes" }, "value": "test2" },
                { "ref": { "id": AssetID, "name": "Light" }, "value": data.light || null },
                { "ref": { "id": AssetID, "name": "CO2" }, "value": data.co2 || null },
                { "ref": { "id": AssetID, "name": "VDD" }, "value": data.vdd || null },
                { "ref": { "id": AssetID, "name": "Humidity" }, "value": data.humidity || null },
                { "ref": { "id": AssetID, "name": "Occupancy" }, "value": data.occupancy || null },
                { "ref": { "id": AssetID, "name": "Sound" }, "value": data.sound || null },
                { "ref": { "id": AssetID, "name": "location" }, "value": { "type": "Point", "coordinates": [data.lat, data.long] } },
                { "ref": { "id": AssetID, "name": "VOC" }, "value": data.tvoc || null }
              ];

            const putEndpoint = "https://<openremote domain>/api/master/asset/attributes" //endpoint for openremote API PUT req  
            let token = await getAuthToken();
            
            try {
                const putResponse = await fetch(putEndpoint, {
                    method: "PUT",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${token}`
                    },
                    agent: httpsAgent,
                    body: JSON.stringify(reqBodyPut)
                });
                console.log(reqBodyPut);

                // Handle the response from the PUT request
                if (!putResponse.ok) {
                    throw new Error(`PUT request failed with status: ${putResponse.status}`);
                }

                const putResult = await putResponse.json();
                context.log("PUT request successful:", putResult);

            } catch (error) {
                context.log("Error during PUT request:", error.message);
            }


            // Return response, what azure sends back to the sender
            return {
                status: 200,
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    ID: devEUI,
                    decodedData: data
                })
            };
        
            

        } catch (error) {
            context.log("Error processing request:", error);
            return {
                status: 500,
                body: `An error occurred: ${error.message}`
            };
        } 

    }
    
});
