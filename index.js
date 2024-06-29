const fs = require('fs').promises;
const axios = require('axios');
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');

async function asyncForEach(array, callback) {
	for (let index = 0; index < array.length; index++) {
		await callback(array[index], index, array);
	}
}

const calendar = google.calendar('v3');

const SCOPES = ['https://www.googleapis.com/auth/calendar'];

const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

async function loadSavedCredentialsIfExist() {
	try {
		const content = await fs.readFile(TOKEN_PATH);
		const credentials = JSON.parse(content);
		return google.auth.fromJSON(credentials);
	} catch (err) {
		return null;
	}
}

/**
 * Serializes credentials to a file compatible with GoogleAuth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
	const content = await fs.readFile(CREDENTIALS_PATH);
	const keys = JSON.parse(content);
	const key = keys.installed || keys.web;
	const payload = JSON.stringify({
		type: 'authorized_user',
		client_id: key.client_id,
		client_secret: key.client_secret,
		refresh_token: client.credentials.refresh_token,
	});
	await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
	let client = await loadSavedCredentialsIfExist();
	if (client) {
		return client;
	}
	client = await authenticate({
		scopes: SCOPES,
		keyfilePath: CREDENTIALS_PATH,
	});
	if (client.credentials) {
		await saveCredentials(client);
	}
	return client;
}

const isChallengeOrCup = (name) => {
	return name.toLowerCase().includes('challenge') || name.toLowerCase().includes('cup');
};

const getPokemonEvents = async (auth) => {
	const {data} = await axios({
		method: 'get',
		// modify the url to get events in your area
		url: `https://op-core.pokemon.com/api/v2/event_locator/search/?latitude=30.267153&longitude=-97.7430608&distance=100`,
	});

	let events = data.activities;
	events = events.filter((event) => {
		return event.activity_format === 'tcg_std' && event.activity_type === 'tournament' && isChallengeOrCup(event.name);
	});

	const result = events.map((event) => {
		const adjustedTime = new Date(event.start_datetime).getTime() + 5 * 60 * 60 * 1000; // Adjust for timezone

		return {
			summary: event.name,
			location: event.address.full_address,
			description: event.pokemon_url,
			start: {
				dateTime: new Date(adjustedTime),
				timeZone: 'America/Chicago',
			},
			end: {
				dateTime: new Date(adjustedTime),
				timeZone: 'America/Chicago',
			},
		};
	});

	return [result, auth];
};

const addEvent = async (event, auth) => {
	calendar.events.insert(
		{
			auth,
			// modify the calendarId to your calendar id
			calendarId: '',
			resource: event,
		},
		function (err, event) {
			if (err) {
				console.log('There was an error contacting the Calendar service: ' + err);
				return;
			}
			console.log('Event created: %s', event.data.start);
		}
	);
};

authorize()
	.then((auth) => {
		getPokemonEvents(auth).then(([events, auth]) => {
			asyncForEach(events, async (event, index) => {
				await addEvent(event, auth, index);
			});
		});
	})
	.catch(console.error);
