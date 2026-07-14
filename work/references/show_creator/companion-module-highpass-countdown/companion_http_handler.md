HTTP Handler
Jeff Martin edited this page on Mar 7 · 2 revisions
Companions webserver that servers the Web UI also provides a path for each connection so that HTTP requests can be passed through to an instance of a module, which can then choose to respond or otherwise Companion will automatically respond with a 404. The path to an instance will be /instance/INSTANCE NAME/, so for example if a user has Companion on http://127.0.0.1:8000/ and creates a Google Sheets connection called 'sheet', HTTP traffic to http://127.0.0.1:8000/instance/sheet/ will be forwarded to the HTTP handler in Google Sheets for that connection.

Because each instance acts as a child process of Companion, only a subset of the properties for a HTTP request to Express are passed on to the child processes. This allows for most common usages, but more complex setups such as utilizing the HTTP handler for WebSockets will not work.

A few example use cases for the HTTP handler:

Expose data generated/collected by the module. For example the Google Sheets module makes all of the spreadsheet data available as both JSON and CSV, this allows apps such as vMix to utilize that as a data source far more efficiently and responsively than if it was to interact with Google Sheets itself.
Expose some of the functionality of Actions, so if an external device/service needs to be able to run an Action it could be made available to be run directly rather than requiring it placed on a button and then use Companions API to press/release that button.
A HTML page that acts as a UI for users, which could even pull data from JSON endpoints to dynamically fill that HTML page with data, and POST endpoints that the page can send requests to for triggering functionality in the module.
handleHttpRequest
The handleHttpRequest method on the Instance class is what handles HTTP requests being passed from Companion to the module instance

handleHttpRequest(request: CompanionHTTPRequest): CompanionHTTPResponse | Promise<CompanionHTTPResponse> {
  // Handle HTTP request and return a response
}
CompanionHTTPRequest
Property	Type
baseUrl	string
body?	string
headers	Record<string, string>
hostname	string
ip	string
method	string
originalUrl	string
path	string
query	Record<string, string>
CompanionHTTPResponse
Property	Type
status?	number
headers?	Record<string, any>
body?	string
JSON Response Example
handleHttpRequest(request: CompanionHTTPRequest): CompanionHTTPResponse | Promise<CompanionHTTPResponse> {
  const endpoint = request.path.replace('/', '').toLowerCase();

  // Requests to the `/instance/INSTANCE NAME/data` endpoint returns data as a JSON response
  const dataResponse = () => {
    return {
      status: 200,
      body: JSON.stringify({
        value1: this.label,
        value2: 123,
        value3: this.someValue
      }),
      headers: {
        'Content-Type': 'application/json',
      },
    }
  };

  // Requests to the `/instance/INSTANCE NAME/config` endpoint returns current config as a JSON response
  const configResponse = () => {
    return {
      status: 200,
      body: JSON.stringify(this.config),
      headers: {
        'Content-Type': 'application/json',
      },
    }
  };

  if (request.method === 'GET') {
    if (endpoint === 'data') return dataResponse()
    if (endpoint === 'config') return configResponse()
  }

  return {
    status: 404,
    body: JSON.stringify({ status: 404, error: `API endpoint ${endpoint} for connection ${this.label} not found` })
  }
}
HTML Response Example
import fs from 'fs'


handleHttpRequest(request: CompanionHTTPRequest): CompanionHTTPResponse | Promise<CompanionHTTPResponse> {
  const endpoint = request.path.replace('/', '').toLowerCase();

  // If a request is to `/instance/INSTANCE NAME/` respond with the index.html, otherwise load whatever file is being requested.
  // In production it is HIGHLY recommended to pre-loading the files to be served and responding with only those specific files rather than a wildcard
  if (request.method === 'GET') {
    const filePath = endpoint === '' ? './html/index.html' : `./html/${endpoint}`;

    // While here the files being returned are static files stored with the module,
    // it is entirely possible to dynamically generate a HTML response, much like the JSON example previously
    const exists = fs.existsSync(filePath);

    if (!exists) {
      return {
        status: 404,
        body: JSON.stringify({ status: 404, error: `API endpoint ${endpoint} for connection ${this.label} not found` })
      }
    }

    // Content-Type should generally be handled by Express on companions side, but for some file types being served you may need to manually set the header
    return {
      status: 200,
      body: fs.readFileSync(file).toString()
    }
  }

  return {
    status: 404,
    body: JSON.stringify({ status: 404, error: `API endpoint ${endpoint} for connection ${this.label} not found` })
  }
}