const fs = require('fs').promises;
const axios = require('axios');
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');

// example of calenders
const calenders = [
	{
		shareableUrl: '',
		calenderId: '',
		timeOffSet: 5,
		timeZone: 'America/Chicago',
		city: 'Austin',
		url: 'latitude=30.267153&longitude=-97.7430608&distance=100',
	},
	{
		shareableUrl: '',
		calenderId: '',
		timeOffSet: 5,
		timeZone: 'America/Chicago',
		city: 'San Antonio',
		url: 'latitude=29.4251905&longitude=-98.4945922&distance=100',
	},
	{
		shareableUrl: '',
		calenderId: '',
		timeOffSet: 5,
		timeZone: 'America/Chicago',
		city: 'Houston',
		url: 'latitude=29.7600771&longitude=-95.37011079999999&distance=100',
	},
	{
		shareableUrl: '',
		calenderId: '',
		timeOffSet: 5,
		timeZone: 'America/Chicago',
		city: 'Dallas',
		url: 'latitude=32.7766642&longitude=-96.79698789999999&distance=100',
	},
	{
		shareableUrl: '',
		calenderId: '',
		timeOffSet: 5,
		timeZone: 'America/Chicago',
		city: 'Fort Worth',
		url: 'latitude=32.7554883&longitude=-97.3307658&distance=100',
	},
	{
		shareableUrl: '',
		calenderId: '',
		timeOffSet: 5,
		timeZone: 'America/Chicago',
		city: 'Tyler',
		url: 'latitude=32.3512601&longitude=-95.30106239999999&distance=100',
	},
	{
		shareableUrl: '',
		calenderId: '',
		timeOffSet: 5,
		timeZone: 'America/Chicago',
		city: 'College Station',
		url: 'atitude=30.627977&longitude=-96.3344068&distance=100',
	},
];

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

const fixTimeIssue = (time, offset) => {
	// Adjust for timezone
	return new Date(time).getTime() + offset * 60 * 60 * 1000;
};

const getPokemonEvents = async (auth, url, timeOffSet) => {
	const {data} = await axios({
		method: 'get',
		url: `https://op-core.pokemon.com/api/v2/event_locator/search/?${url}`,
	});

	let events = data.activities;
	events = events.filter((event) => {
		return event.activity_format === 'tcg_std' && event.activity_type === 'tournament' && isChallengeOrCup(event.name);
	});

	const result = events.map((event) => {
		const adjustedTime = fixTimeIssue(event.start_datetime, timeOffSet);

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

	return result;
};

async function listEvents(auth, calendarId) {
	const calendar = google.calendar({version: 'v3', auth});

	const res = await calendar.events.list({
		calendarId: calendarId,
		timeMin: new Date().toISOString(),
		// maxResults: 10,
		singleEvents: true,
		orderBy: 'startTime',
	});
	const events = res.data.items;
	if (!events || events.length === 0) {
		// console.log('No upcoming events found.');
		return [];
	}

	return events.map((event) => event.description);
}

const filterEvents = (events, existingEvents) => {
	return events.filter((event) => !existingEvents.includes(event.description));
};

const addEvent = async (event, auth, calendarId) => {
	calendar.events.insert(
		{
			auth,
			calendarId: calendarId,
			resource: event,
		},
		function (err, event) {
			if (err) {
				console.log('There was an error contacting the Calendar service: ' + err);
				return;
			}
			// console.log('Event created: %s', event.data.start);
		}
	);
};

const run = async () => {
	const auth = await authorize();
	asyncForEach(calenders, async (calender) => {
		const {calenderId, timeOffSet, city, url} = calender;
		const existingEvents = await listEvents(auth, calenderId);
		const eventsInArea = await getPokemonEvents(auth, url, timeOffSet);
		const newEvents = filterEvents(eventsInArea, existingEvents);

		asyncForEach(newEvents, async (event) => {
			await addEvent(event, auth, calenderId);
		});

		console.log(`${newEvents.length} events added for ${city}`);
	});
};

run();
