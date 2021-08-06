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

	if (data.type !== 'theme' && data.type !== 'plugin') {
		return getErrorResponse("The first URL path segment is missing a valid entity type. Must be either 'plugins' or 'themes'.");
	}

	if (!data.vendor) {
		return getErrorResponse('The second URL path segment is missing. It should contain the vendor name.');
	}

	if (!data.package) {
		return getErrorResponse('The third URL path segment is missing. It should contain the package name.');
	}

	response = await gitHubRequest(
		`https://api.github.com/repos/${ data.vendor }/${ data.package }/releases`
	);

	let releases = await response.json();

	// Proxy error response
	if (response.status !== 200) {
		return getResponse(releases, response.status);
	}

	// Return 404 if a release isn't found
	if (!releases || !Array.isArray(releases) || !releases.length) {
		return getResponse('No releases available!', 404);
	}

	// Skip over releases without release assets.
	for (release of releases) {
		if (release.assets.length) {
			data.release = release;
			break;
		}
	}

	// Return 404 if no release asset is found.
	if (!data?.release?.assets?.length) {
		return getResponse('No release asset found!', 404);
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

	const type = segments[0] ? segments[0].slice(0, -1) : null;
	const vendor = segments[1] ? segments[1] : null;
	const _package = segments[2] ? segments[2] : null;
	const isDownload = !!(segments[3] && 'download' === segments[3]) || url.searchParams.has('download');

	const slug = url.searchParams.get('slug') || _package;
	const file = url.searchParams.get('file') || (type === 'theme' ? 'style.css' : `${ _package }.php`);

	const basename = `${ slug }/${ file }`;

	return {
		type,
		vendor,
		package: _package, // Package is a reserved keyword in JavaScript
		slug,
		file,
		basename,
		isDownload
	};
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
		version: data.fileHeaders['Version'] || '',
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
