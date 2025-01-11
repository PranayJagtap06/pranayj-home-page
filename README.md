# pranayj-home-page
PranayJ's Home Page.

Step 1: Create a project in the Google Cloud Console

Go to the Google Cloud Console.
Click on the "Select a project" dropdown menu and click on "New Project".
Enter a project name and click on "Create".
Step 2: Enable the Google Drive API

In the sidebar, click on "APIs & Services" and then click on "Dashboard".
Click on "Enable APIs and Services" and search for "Google Drive API".
Click on "Google Drive API" and click on the "Enable" button.
Step 3: Create credentials for your project

In the sidebar, click on "APIs & Services" and then click on "Credentials".
Click on "Create Credentials" and select "OAuth client ID".
Select "Web application" and enter a authorized JavaScript origins (e.g., http://localhost:8080).
Click on "Create" and copy the client_id and client_secret.
Step 4: Set up the redirect URI

In the sidebar, click on "APIs & Services" and then click on "Credentials".
Click on the three vertical dots next to your OAuth client ID and select "Edit".
In the "Authorized Redirect URIs" field, enter the URL that you want to redirect to after authorization (e.g., http://localhost:8080/callback).
Step 5: Use the credentials as environment variables

You can use the client_id, client_secret, and redirect_uri as environment variables in your script. Here's an example of how you can do it:

Using a .env file

Create a new file named .env in the root of your project and add the following lines:

makefile
Insert Code
Run
Copy code
GOOGLE_CLIENT_ID=your_client_id
GOOGLE_CLIENT_SECRET=your_client_secret
GOOGLE_REDIRECT_URI=your_redirect_uri
Replace your_client_id, your_client_secret, and your_redirect_uri with the actual values.

Using a environment variable in your script

In your script, you can access the environment variables using the following code:

javascript
Insert Code
Run
Copy code
const client_id = process.env.GOOGLE_CLIENT_ID;
const client_secret = process.env.GOOGLE_CLIENT_SECRET;
const redirect_uri = process.env.GOOGLE_REDIRECT_URI;
Make sure to install the dotenv package and require it in your script to use the .env file:

bash
Insert Code
Run
Copy code
npm install dotenv
javascript
Insert Code
Run
Copy code
require('dotenv').config();
Alternatively, you can set the environment variables directly in your operating system. Here's an example of how to do it:

On Linux/Mac

Open your terminal and run the following commands:

bash
Insert Code
Run
Copy code
export GOOGLE_CLIENT_ID=your_client_id
export GOOGLE_CLIENT_SECRET=your_client_secret
export GOOGLE_REDIRECT_URI=your_redirect_uri
On Windows

Open your Command Prompt and run the following commands:

bash
Insert Code
Run
Copy code
set GOOGLE_CLIENT_ID=your_client_id
set GOOGLE_CLIENT_SECRET=your_client_secret
set GOOGLE_REDIRECT_URI=your_redirect_uri
Replace your_client_id, your_client_secret, and your_redirect_uri with the actual values.
