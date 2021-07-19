let api = "";
fetch("/js/env.json").then(response => {
    response.json().then(data => {
        console.log("API:", data.api);
        api = data.api + "stack"
    })
});

const getKey = () => { return document.getElementById("key").value; } 
const getNotificationEmail = () => { return document.getElementById("email").value; }

const createdStatus = "Created";
const creatingStatus = "Creating";
const failedStatus = "Failed";

let detailsInterval;
let startedCreating = false;

const emailElement = document.getElementById("email");
const spinnerElement = document.getElementById("spinner");
const provisionButton = document.getElementById("provision-btn");
const getDetailsButton = document.getElementById("get-details-btn")

async function getStackDetails() {
    const response = await fetch(api, {
        method: 'GET', 
        mode: 'cors', 
        cache: 'no-cache', 
        headers: {
          'X-API-KEY': getKey(),
          'Content-Type': 'application/json'
        }
      });
      console.log(response);
      return response.json();
}

async function provisionStack(){
    const response = await fetch(api, {
        method: 'POST', 
        mode: 'cors', 
        cache: 'no-cache', 
        headers: {
          'X-API-KEY': getKey(),
          'Content-Type': 'application/json'
        },
        body: `{"notificationEmail": "${getNotificationEmail()}"}`
    });

    console.log(response);
    
    return response.json();
}

function isValidEmail(email) {
    const emailRegularExpression = /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return emailRegularExpression.test(String(email).toLowerCase());
}

function validateEmail() {
    const email = getNotificationEmail();
    if (!isValidEmail(email)) {
        emailElement.classList.add("border-danger");
    }
    else {
        emailElement.classList.remove("border-danger");
    }
}

function showDetails(data) {

    document.getElementById("stack-name").innerHTML = data.stackName;
    document.getElementById("times-provisioned").innerHTML = data.numTimesProvisioned;
    document.getElementById("max-times-provisioned").innerHTML = data.maxCreationTimes;
    document.getElementById("status").innerHTML = data.stackStatus;

    let links = "<p>-</p>";
    let destroyTime = "-"

    if(data.stackStatus === createdStatus) {
        links = "";
        console.log("links", links);
        Object.keys(data.outputs).forEach(function(parameterKey) {
            links = links + '<p><a class="link-dark" href="' + data.outputs[parameterKey].M.value.S + '" target="_blank">' + data.outputs[parameterKey].M.description.S + '</a></p>';
        });

        let destroyInSeconds = parseInt(data.destroyInSeconds, 10);
        let createdTime = parseInt(data.createdTime, 10);
        destroyTime = calcTimeLeftBeforeStackIsDestroyed(destroyInSeconds, createdTime);
    }
    

    document.getElementById("links").innerHTML = links;
    document.getElementById("destroy-time").innerHTML = destroyTime;
}

emailElement.addEventListener("keyup", function() {
    validateEmail();
});

provisionButton.addEventListener("click", function() {

    if(!isValidEmail(getNotificationEmail()) || getKey().trim() === "") {
        showError("Invalid email or key!");
        return;
    }   

    startedCreating = false;

    getStackDetails().then(data => {

        console.log("Stack details", data);

        if (data["numTimesProvisioned"] === data["maxCreationTimes"]) {
            showError(`You have already provisioned this app ${data["numTimesProvisioned"]} times that is the masimum allowed. If you need more please ask the developer.`);
        }
        else if (data['stackStatus'] === creatingStatus ) {
            showError("Please wait that your application is being provisioned already.");
        }
        else if (data['stackStatus'] === createdStatus ) {
            showError("Your application is already created.");
        }
        else {
            provisionStack().then(data => {
                provisionButton.disabled = true;
                console.log("Stack provision response", data);
                showSuccess();
                showDetailsUntilCreated();
            }).catch(error => {
                showError("Failed to create the application. Make sure you have entered the right key!");
            });
        }
    }).catch(error => {
        console.error(error);
        showError("Failed to get details for your aplication. Make sure you have entered the right key!");
    });
});

getDetailsButton.addEventListener("click", function() {

    if(getKey().trim() === "") {
        showError("Invalid key!");
        return;
    }

    getStackDetails().then(data => {
        console.log("Stack details", data);
        showDetails(data);
    }).catch(error => {
        console.error(error);
        showError("Failed to get details for your aplication. Make sure you have entered the right key!");
    });
});

function showError(errorMessage) {

    const dangerAlertElement = document.getElementsByClassName("alert-danger")[0];

    dangerAlertElement.innerHTML = errorMessage;
    dangerAlertElement.classList.toggle("visually-hidden");
    setTimeout(() => {
        dangerAlertElement.classList.toggle("visually-hidden");
    }, 5000);
}

function showSuccess() {
    const successAlertElement = document.getElementsByClassName("alert-success")[0];

    successAlertElement.classList.toggle("visually-hidden");
    setTimeout(() => {
        successAlertElement.classList.toggle("visually-hidden");
    }, 3000);
}

function calcTimeLeftBeforeStackIsDestroyed(destroyInSeconds, lastUpdated) {

    let estimatedDestroyTime = new Date(lastUpdated + (destroyInSeconds * 1000));
    let now = new Date();

    let diffMs = estimatedDestroyTime - now;
    let response = "";

    if (diffMs > 0 ) {

        let diffDays = Math.floor(diffMs / 86400000); // days
        let diffHrs = Math.floor((diffMs % 86400000) / 3600000); // hours
        let diffMins = Math.round(((diffMs % 86400000) % 3600000) / 60000); // minutes

        if (diffDays > 0) {
            response += `${diffDays} days, `;
        }
        response += `${diffHrs} hour(s) and  ${diffMins} minute(s)`;
    }
    else {
        response = "0 minutes";
    }

    return response;
}

function showDetailsUntilCreated() {
    spinnerElement.classList.add("spinner-grow");
    detailsInterval = setInterval(() => {
        getStackDetails().then(data => {
            showDetails(data);
            let status = data.stackStatus;
            
            if (status === creatingStatus) {
                startedCreating = true;
            }
            else if (startedCreating && (status === createdStatus || status === failedStatus)) {
                clearInterval(detailsInterval);
                spinnerElement.classList.remove("spinner-grow");
                provisionButton.disabled = false;
            }
        });
      }, 2000);
}
