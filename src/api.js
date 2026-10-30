import { store } from './store.js';

export class ApiError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

/** Calls the server API. GET when there is no body, POST with JSON otherwise. */
export async function api(path, body) {
	const response = await fetch('/api/' + path, {
		method: body === undefined ? 'GET' : 'POST',
		headers: { 'X-DBEditor': '1', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
		body: body === undefined ? undefined : JSON.stringify(body),
		credentials: 'same-origin',
	});
	const data = await response.json().catch(() => ({ error: response.statusText }));
	if (!response.ok) {
		if (response.status === 401 && path !== 'session') store.session = null;
		throw new ApiError(response.status, data.error || response.statusText);
	}
	return data;
}
