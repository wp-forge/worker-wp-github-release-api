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

	if (!data.vendor) {
		return getErrorResponse('Missing URL param: vendor');
	}

	if (!data.package) {
		return getErrorResponse('Missing URL param: package');
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

	// Prepare response
	response = getResponse(getPayload(data));

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

	const data = {
		vendor: url.searchParams.get('vendor'),
		package: url.searchParams.get('package'),
	};

	data.basename = url.searchParams.get('basename') || `${ data.package }/${ data.package }.php`;

	const [slug, file] = data.basename.split('/');

	data.slug = slug;
	data.file = file;

	data.type = data.file.substring(data.file.lastIndexOf('.') + 1) === 'css' ? 'theme' : 'plugin';

	data.isTheme = 'theme' === data.type;
	data.isPlugin = 'plugin' === data.type;

	return data;
}

/**
 * Get response payload.
 *
 * @param data {{}}
 * @returns {{}}
 */
function getPayload(data) {

	const payload = {};

	payload.name = data.isTheme ? data.fileHeaders['Theme Name'] : data.fileHeaders['Plugin Name'];
	payload.type = data.type;

	payload.version = data.fileHeaders['Version'] || '';
	payload.description = data.fileHeaders['Description'] || '';

	payload.author = {};
	payload.author.name = data.fileHeaders['Author'] || '';
	payload.author.url = data.fileHeaders['Author URI'] || '';

	payload.updated = data.release.published_at || '';

	payload.slug = data.slug;

	if (data.isPlugin) {
		payload.basename = data.basename;
	}

	payload.url = data.isTheme ? data.fileHeaders['Theme URI'] : data.fileHeaders['Plugin URI'];
	payload.download = data.release.assets[0].browser_download_url;

	payload.requires = {};
	payload.requires.wp = data.fileHeaders['Requires at least'] || '';
	payload.requires.php = data.fileHeaders['Requires PHP'] || '';

	payload.tested = {};
	payload.tested.wp = data.fileHeaders['Tested up to'] || '';

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
