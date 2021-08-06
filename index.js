/**
 * Handle the incoming request.
 *
 * @param event {Event}
 *
 * @returns {Promise<Response>}
 */
async function handleRequest(event) {

	const request = event.request;
	const url = new URL(request.url);

	// Construct the cache key from the cache URL
	const cacheKey = new Request(url.toString(), request);
	const cache = caches.default;

	// Check if response is in cache
	let response = await cache.match(cacheKey);

	// If cached, return stored result
	if (response) {
		return response;
	}

	// Get the data from the request
	const data = getDataFromRequest(request);

	// Run some error checks
	if (data.type !== 'theme' && data.type !== 'plugin') {
		return getErrorResponse("The first URL path segment is missing a valid entity type. Must be either 'plugins' or 'themes'.");
	}

	if (!data.vendor) {
		return getErrorResponse('The second URL path segment is missing. It should contain the vendor name.');
	}

	if (!data.package) {
		return getErrorResponse('The third URL path segment is missing. It should contain the package name.');
	}

	// Get the release
	try {
		data.latestRelease = await getLatestRelease(data);
		data.release = data.version ? await getRelease(data) : data.latestRelease;
	} catch (e) {
		return getErrorResponse(e.message, 404);
	}

	const filePath = `https://raw.githubusercontent.com/${ data.vendor }/${ data.package }/${ data.release.tag_name }/${ data.file }`;
	response = await gitHubRequest(filePath);

	// Unable to read base file
	if (response.status !== 200) {
		return getResponse(`Unable to fetch ${ data.type } file: ${ filePath }`, 404);
	}

	// Get file headers
	data.fileHeaders = getFileHeaders(await response.text());

	// Get payload
	const payload = getPayload(data);

	// Force a download
	if (data.isDownload) {
		return Response.redirect(payload.download, 301);
	}

	// Prepare response
	response = getResponse(payload);

	// Set cache header
	response.headers.append('Cache-Control', 's=maxage=10');

	// Cache response
	event.waitUntil(cache.put(cacheKey, response.clone()));

	// Return response to the user
	return response;
}

/**
 * Get data from the request.
 *
 * @param request
 * @returns {{}}
 */
function getDataFromRequest(request) {

	const url = new URL(request.url);
	const segments = url.pathname.split('/').filter((value) => !!value);

	// Set entity type
	let type = segments.shift();

	if (type && (type === 'plugin' || type === 'plugins')) {
		type = 'plugin';
	}

	if (type && (type === 'theme' || type === 'themes')) {
		type = 'theme';
	}

	// Set vendor name
	const vendor = segments.shift();

	// Set package name
	const _package = segments.shift();

	// Check if we should download
	let isDownload = segments.includes('download');
	if (isDownload) {
		segments.pop(); // Remove segment so we don't accidentally grab it in the next step
	}

	// Set version, if provided
	let version = segments.shift();

	// Set slug
	const slug = url.searchParams.get('slug') || _package;

	// Set file
	const file = url.searchParams.get('file') || (type === 'theme' ? 'style.css' : `${ _package }.php`);

	// Set basename
	const basename = `${ slug }/${ file }`;

	const data = {
		basename,
		file,
		isDownload,
		package: _package, // Package is a reserved keyword in JavaScript
		slug,
		type,
		vendor,
		version
	};

	return data;
}

/**
 * Get response payload.
 *
 * @param data {{}}
 * @returns {{}}
 */
function getPayload(data) {

	const payload = {
		name: data.type === 'theme' ? data.fileHeaders['Theme Name'] : data.fileHeaders['Plugin Name'],
		type: data.type,
		version: {
			current: data.fileHeaders['Version'],
			latest: data.latestRelease.tag_name
		},
		description: data.fileHeaders['Description'] || '',
		author: {
			name: data.fileHeaders['Author'] || '',
			url: data.fileHeaders['Author URI'] || ''
		},
		updated: data.release.published_at || '',
		requires: {
			wp: data.fileHeaders['Requires at least'] || '',
			php: data.fileHeaders['Requires PHP'] || '',
		},
		tested: {
			wp: data.fileHeaders['Tested up to'] || ''
		},
		url: (data.type === 'theme' ? data.fileHeaders['Theme URI'] : data.fileHeaders['Plugin URI']) || '',
		download: data.release.assets[0].browser_download_url,
		slug: data.slug
	};

	if (data.type === 'plugin') {
		payload.basename = data.basename;
	}

	return payload;
}

/**
 * Get the latest viable release.
 *
 * @param data {{}}
 *
 * @returns {Promise<*>}
 */
async function getLatestRelease(data) {
	let release, releases, response;

	// Fetch the most recent releases from GitHub
	response = await gitHubRequest(
		`https://api.github.com/repos/${ data.vendor }/${ data.package }/releases`
	);
	releases = await response.json();

	// Proxy error response
	if (response.status !== 200) {
		throw releases;
	}

	if (!releases || !Array.isArray(releases) || !releases.length) {
		throw 'No releases available!';
	}

	// Skip over releases without release assets.
	for (release of releases) {
		if (release.assets.length) {
			break;
		}
	}

	if (!release) {
		throw 'No releases have release assets!'
	}

	return release;
}

/**
 * Get a specific plugin or theme release.
 *
 * @param data {{}}
 *
 * @returns {Promise<*>}
 */
async function getRelease(data) {

	let release, releases, response;

	// Fetch a specific release from GitHub
	response = await gitHubRequest(
		`https://api.github.com/repos/${ data.vendor }/${ data.package }/releases/tags/${ data.version }`
	);
	release = await response.json();

	// Proxy error response
	if (response.status !== 200) {
		throw release;
	}

	// Release doesn't have a downloadable
	if (!release.assets.length) {
		throw `Release ${ data.version } doesn't have a release asset!`
	}

	return release;
}

/**
 * Get status text code given an HTTP status code.
 *
 * @param code {integer}
 * @returns {string}
 */
function getStatusText(code) {
	switch (code) {
		case 400:
			return 'Bad Request';
		case 404:
			return 'Not Found';
		default:
			return 'OK';
	}
}

/**
 * Get a new Response object.
 *
 * @param payload {{}}
 * @param status {integer}
 *
 * @returns {Response}
 */
function getResponse(payload, status = 200) {
	return new Response(
		JSON.stringify(payload, null, 2),
		{
			status,
			statusText: getStatusText(status),
			headers: {
				"Content-Type": "application/json"
			}
		}
	);
}

/**
 * Get a new Response object and set up error payload.
 *
 * @param message {string}
 * @param statusCode {integer}
 *
 * @returns {Response}
 */
function getErrorResponse(message, statusCode = 400) {
	return getResponse({status: 'error', message}, statusCode);
}

/**
 * Make a request to GitHub.
 *
 * @param url {string}
 *
 * @returns {Promise<Response>}
 */
async function gitHubRequest(url) {
	return await fetch(
		url,
		{
			method: 'GET',
			headers: {
				'Accept': 'application/vnd.github.v3+json',
				'Authorization': 'Basic ' + btoa(`${ GITHUB_USER }:${ GITHUB_TOKEN }`),
				'User-Agent': 'Cloudflare Workers'
			}
		}
	);
}

/**
 * Get plugin or theme file headers.
 *
 * @param fileContents {string}
 * @returns {{}}
 */
function getFileHeaders(fileContents) {

	const headers = [
		'Author',
		'Author URI',
		'Description',
		'Domain Path',
		'License',
		'License URI',
		'Plugin Name',
		'Plugin URI',
		'Requires at least',
		'Requires PHP',
		'Tested up to',
		'Text Domain',
		'Theme Name',
		'Theme URI',
		'Version'
	];

	const fileHeaders = {};

	headers.forEach((header) => {
		let regex = new RegExp(header + ':(.*)', 'gm');
		let matches = regex.exec(fileContents);
		if (matches && matches.hasOwnProperty(1)) {
			fileHeaders[header] = matches[1].trim();
		}
	});

	return fileHeaders;
}

addEventListener(
	'fetch',
	(event) => {
		event.respondWith(
			handleRequest(event).catch(
				(err) => new Response(err.stack, {status: 500})
			)
		);
	}
);
