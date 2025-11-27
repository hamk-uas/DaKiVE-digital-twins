process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const https = require('https');
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));
const { customAlphabet } = require('nanoid');
const { json } = require('stream/consumers');



const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const authConfig = {
    authUrl: "https://172.160.243.127/auth/realms/master/protocol/openid-connect/token",
    clientID: "user1",
    clientSecret: "",
    refreshToken: null,
    accessToken: null,
    tokenExpiry: 0 
};

const getAuthToken = async () => {
    try {
        const requestBody = new URLSearchParams();
        requestBody.append("client_id", authConfig.clientID);
        requestBody.append("client_secret", authConfig.clientSecret);
        requestBody.append("grant_type", authConfig.refreshToken ? "refresh_token" : "client_credentials");
        if (authConfig.refreshToken) requestBody.append("refresh_token", authConfig.refreshToken);

        const response = await fetch(authConfig.authUrl, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: requestBody,
            agent: httpsAgent
        });

        if (!response.ok) {
            throw new Error(`Failed to get auth token. Status: ${response.status}`);
        }

        const data = await response.json();
        authConfig.accessToken = data.access_token;
        authConfig.refreshToken = data.refresh_token;
        authConfig.tokenExpiry = Date.now() + data.expires_in * 1000;
        
        return authConfig.accessToken;
    } catch (error) {
        console.error("Error getting auth token:", error);
        throw error;
    }
};

const fetchDataAndSearch = async (searchString) => {
    const apiEndpoint = "https://172.160.243.127/api/master/asset/query";

    const getValidToken = async () => {
        if (!authConfig.accessToken || Date.now() >= authConfig.tokenExpiry) {
            console.log("Token expired or not available. Fetching a new one...");
            return await getAuthToken();
        }
        return authConfig.accessToken;
    };

    let token = await getValidToken();

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const response = await fetch(apiEndpoint, {
                method: "POST",
                headers: { 
                    "Authorization": `Bearer ${token}`,
                    "Content-Type": "application/json"
                },
                agent: httpsAgent
            });

            if (response.ok) {
                const data = await response.json(); 
                const matched = data.find(({name}) => name === searchString);  
                if (matched) {
                    const exists = true;
                    const assetID = matched.id;
                    console.log("assetID from checkassetJS is", assetID);
                    return { exists: true, assetId: matched.id };
                }
                else {
                    return { exists: false, assetId: null };
                }
            }

            if (response.status === 401) {
                console.log("Token invalid. Fetching a new token...");
                token = await getAuthToken();
            } else {
                throw new Error(`Failed to fetch data. Status: ${response.status}`);
            }
        } catch (error) {
            console.error("Error during fetch:", error);
            if (attempt === 1) throw error;
        }
    }
    throw new Error("Failed after retries");
};

const createAsset = async (assetData) => {
    const apiUrl = "https://172.160.243.127/api/master/asset";
    const token = await getAuthToken();

    const requestBody = {
        id: assetData.id|| null,
        version: assetData.version || 0,
        createdOn: new Date().toISOString(),
        name: assetData.name,
        accessPublicRead: assetData.accessPublicRead || false,
        parentId: assetData.parentId || null,
        realm: assetData.realm,
        type: assetData.type || "string",
        path: assetData.path || [],
        attributes: assetData.attributes || {}
    };

    const response = await fetch(apiUrl, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody),
        agent: httpsAgent
    });

    if (!response.ok) {
        throw new Error(`Failed to create asset. Status: ${response.status}`);
    }

    const result = await response.json();
    console.log("Asset Created:", result);
    return result;
};

const checkAndCreateAsset = async (searchString, assetData) => {
    try {
        const exists = await fetchDataAndSearch(searchString);
        if (exists.exists) {
            console.log(`Asset '${searchString}' already exists.`);
            return exists;
        } else {
            console.log(`Asset '${searchString}' not found. Creating it now...`);
            assetData.name = searchString;
            const created = await createAsset(assetData);
            return { exists: true, assetId: created.id };;
        }
    } catch (error) {
        console.error("Error in checkAndCreateAsset:", error);
        return { exists: false, assetId: null };
    }
};
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';


function generateAssetData(data, searchString) {
    const id = customAlphabet(alphabet, 22);
    console.log(data);
    //const idsearch = async await fetchDataAndSearch(searchString);
    return {
        "id": id,
        "version": 0,
        "createdOn": Date.now(),
        "name": searchString,
        "accessPublicRead": false,
        "parentId": "4Bfqg8gMhH5k8clvXOpf8G",
        "realm": "master",
        "type": "ThingAsset",
        "path": [
            "4Bfqg8gMhH5k8clvXOpf8G",
            id
        ],
        "attributes": {
            "Motion": {
                "name": "Motion",
                "type": "number",
                "meta": {
                    "accessRestrictedRead": true,
                    "accessRestrictedWrite": true
                },
                "value": data.Motion || null,
                "timestamp": Date.now() 
            },
            "Temperature": {
                "name": "Temperature",
                "type": "number",
                "meta": {
                    "accessRestrictedRead": true,
                    "accessRestrictedWrite": true
                },
                "value": data.temperature || null,
                "timestamp": Date.now()
            },
            "notes": {
                "name": "notes",
                "type": "text",
                "meta": {},
                "value": null,
                "timestamp": Date.now()
            },
            "Light": {
                "name": "Light",
                "type": "number",
                "meta": {
                    "accessRestrictedRead": true,
                    "accessRestrictedWrite": true
                },
                "value": data.Light || null,
                "timestamp": Date.now()
            },
            "CO2": {
                "name": "CO2",
                "type": "number",
                "meta": {
                    "accessRestrictedRead": true,
                    "accessRestrictedWrite": true
                },
                "value": data.CO2 || null,
                "timestamp": Date.now()
            },
            "VDD": {
                "name": "VDD",
                "type": "number",
                "meta": {
                    "accessRestrictedRead": true,
                    "accessRestrictedWrite": true
                },
                "value": data.vdd || null,
                "timestamp": Date.now()
            },
            "Humidity": {
                "name": "Humidity",
                "type": "number",
                "meta": {
                    "accessRestrictedRead": true,
                    "accessRestrictedWrite": true
                },
                "value": data.humidity || null,
                "timestamp": Date.now()
            },
            "Occupancy": {
                "name": "Occupancy",
                "type": "number",
                "meta": {
                    "accessRestrictedRead": true,
                    "accessRestrictedWrite": true
                },
                "value": data.Occupancy || null,
                "timestamp": Date.now()
            },
            "Sound": {
                "name": "Sound",
                "type": "number",
                "meta": {
                    "accessRestrictedRead": true,
                    "accessRestrictedWrite": true
                },
                "value": data.Sound || null,
                "timestamp": Date.now()
            },
            "location": {
                "name": "location",
                "type": "GEO_JSONPoint",
                "meta": {},
                "value": data.location || null,
                "timestamp": Date.now()
            },
            "VOC": {
                "name": "VOC",
                "type": "number",
                "meta": {
                    "accessRestrictedRead": true,
                    "accessRestrictedWrite": true
                },
                "value": data.VOC || null,
                "timestamp": Date.now()
            }
        }
    };
}
const newID = customAlphabet(alphabet, 22);
const assetData = {
    "id": newID,                    //"7TdRIViOARtQ1XdoCmIUkl", 
    "version": 0,
    "createdOn": Date.now(),
    "name": "New Asset ", 
    "accessPublicRead": false,
    "parentId": "4Bfqg8gMhH5k8clvXOpf8G" , //dynamically change if asset is moved
    "realm": "master",
    "type": "ThingAsset",
    "path": [
        "4Bfqg8gMhH5k8clvXOpf8G",
        newID  //change to be same as id and parent id
    ],  //check how this functions and need to change 
    "attributes": {
        "Motion": {
            "name": "Motion",
            "type": "number",
            "meta": {
                "accessRestrictedRead": true,
                "storeDataPoints": true,
                "accessRestrictedWrite": true
            },
            "value":  null,
            "timestamp": Date.now()
        },
        "Temperature": {
            "name": "Temperature",
            "type": "number",
            "meta": {
                "accessRestrictedRead": true,
                "storeDataPoints": true,
                "accessRestrictedWrite": true
            },
            "value":  null,  //cahnge to payload
            "timestamp": Date.now() //change dynamically
        },
        "notes": {
            "name": "notes",
            "type": "text",
            "meta": {},
            "value": null,
            "timestamp": Date.now()
        },
        "Light": {
            "name": "Light",
            "type": "number",
            "meta": {
                "accessRestrictedRead": true,
                "storeDataPoints": true,
                "accessRestrictedWrite": true
            },
            "value":  null,
            "timestamp": Date.now()
        },
        "CO2": {
            "name": "CO2",
            "type": "number",
            "meta": {
                "accessRestrictedRead": true,
                "storeDataPoints": true,
                "accessRestrictedWrite": true
            },
            "value": null,
            "timestamp": Date.now()
        },
        "VDD": {
            "name": "VDD",
            "type": "number",
            "meta": {
                "accessRestrictedRead": true,
                "storeDataPoints": true,
                "accessRestrictedWrite": true
            },
            "value":  null,
            "timestamp": Date.now()
        },
        "Humidity": {
            "name": "Humidity",
            "type": "number",
            "meta": {
                "accessRestrictedRead": true,
                "storeDataPoints": true,
                "accessRestrictedWrite": true
            },
            "value":  null,
            "timestamp": Date.now()
        },
        "Occupancy": {
            "name": "Occupancy",
            "type": "number",
            "meta": {
                "accessRestrictedRead": true,
                "storeDataPoints": true,
                "accessRestrictedWrite": true
            },
            "value":  null,
            "timestamp": Date.now()
        },
        "Sound": {
            "name": "Sound",
            "type": "number",
            "meta": {
                "accessRestrictedRead": true,
                "storeDataPoints": true,
                "accessRestrictedWrite": true
            },
            "value":  null,
            "timestamp": Date.now()
        },
        "location": {
            "name": "location",
            "type": "GEO_JSONPoint",
            "meta": {},
            "value":  null,
            "timestamp": Date.now()
        },
        "VOC": {
            "name": "VOC",
            "type": "number",
            "meta": {
                "accessRestrictedRead": true,
                "storeDataPoints": true,
                "accessRestrictedWrite": true
            },
            "value":  null,
            "timestamp": Date.now()
        }
    }
};

module.exports = {
    checkAndCreateAsset,
    createAsset,
    fetchDataAndSearch,
    getAuthToken,
    generateAssetData,
    assetData
};

