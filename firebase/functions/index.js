'use strict';

const admin = require('firebase-admin');
const functions = require('firebase-functions');
const mustache = require('mustache');

admin.initializeApp(functions.config().firebase);
const db = admin.database();

/**
 * @param ref reference to the array
 * @return a promise containing a reference to a randomly picked item from an array
 */
function getRandomItem(ref) {
    console.info(`Picking random item from: ${ref}`);
    return ref.once('value').then(items => {
        const numItem = items.numChildren();
        const randomPos = Math.floor(Math.random() * numItem);
        const itemRef = ref.child(randomPos);
        console.info(`Item ${itemRef} picked`);
        return itemRef;
    });
}

function getRandomArrayItem(array) {
    const randomPos = Math.floor(Math.random() * array.length);
    return array[randomPos];
}

/**
 * Initializes a pet for a given user
 * @param userRef reference to the user
 * @returns a refence to a pet
 */
function createPet(userRef) {
    console.info(`Creating a pet for user ${userRef.key}`);
    return db.ref('pets').push().then(petRef => {
        return getRandomItem(db.ref('petTypes')).then(petTypeRef => {
            return getRandomItem(petTypeRef.child('names')).then(nameRef => {
                return nameRef.once('value');
            }).then(name => {
                return petRef.set({
                    'userId': userRef.key,
                    'petTypeId': petTypeRef.key,
                    'name': name.val()
                });
            });
        }).then(() => {
            return userRef.update({
                'petId': petRef.key
            }).then(() => {
                return petRef;
            });
        });
    });
}

/**
 * Gets or creates a pet for a user and returns a promise for a db pet reference
 * @param userRef reference to the user node.
 */
function getOrCreatePet(userRef) {
    console.info(`Getting or creating a pet for user ${userRef.key}`);
    return userRef.once('value').then(user => {
        if (!user.val().petId) {
            console.info(`Creating a pet for user ${userRef.key}`);
            return createPet(userRef);
        } else {
            console.info(`Found pet ${user.val().petId}`);
            return db.ref('pets/' + user.val().petId);
        }
    });
}

/**
 * Obtains a pet type metadata
 * @param petTypeId
 * @return a promise containing a pet type structure
 */
function getPetType(petTypeId) {
    console.log(`Getting pet type ${petTypeId}`);
    return db.ref('petTypes/' + petTypeId).once('value').then(petType => petType.val());
}

function evaluateOperator(op, params, petType, context) {
    console.info(`Evaluating condition - Executing operation ${op} with params ${JSON.stringify(params)}`);
    switch(op.toLowerCase()) {
        case 'and':
            for (let paramId in params) {
                const val = evaluateCondition(params[paramId], petType, context);
                if (!val) return false;
            }
            return true;
        case 'or':
            for (let paramId in params) {
                const val = evaluateCondition(params[paramId], petType, context);
                if (val) return true;
            }
            return false;
        case 'not':
            return !evaluateCondition(params[0], petType, context);
        case '<':
            return evaluateCondition(params[0], petType, context)
                < evaluateCondition(params[1], petType, context);
        case '>':
            return evaluateCondition(params[0], petType, context)
                > evaluateCondition(params[1], petType, context);
        case '>=':
            return evaluateCondition(params[0], petType, context)
                >= evaluateCondition(params[1], petType, context);
        case '<=':
            return evaluateCondition(params[0], petType, context)
                <= evaluateCondition(params[1], petType, context);
        case '==':
            return evaluateCondition(params[0], petType, context)
                === evaluateCondition(params[1], petType, context);
        case '!=':
            return evaluateCondition(params[0], petType, context)
                !== evaluateCondition(params[1], petType, context);
        case 'exists':
        case 'isnotempty':
            return !!evaluateCondition(params[0], petType, context);
        case 'notexists':
        case 'isempty':
            return !evaluateCondition(params[0], petType, context);
        case 'first':
        case 'any':
            // TODO: for 'any' we should implement random
            for (let paramId in params) {
                const val = evaluateCondition(params[paramId], petType, context);
                if (val) return val;
            }
            return undefined;
        case 'in': {
            const value = evaluateCondition(params[0], petType, context);
            for (let i = 1; i < params.length; i++) {
                const value2 = evaluateCondition(params[i], petType, context);
                if (value === value2) {
                    return true;
                }
            }
            return false;
        }
        case 'notIn': {
            const value = evaluateCondition(params[0], petType, context);
            for (let i = 1; i < params.length; i++) {
                const value2 = evaluateCondition(params[i], petType, context);
                if (value === value2) {
                    return false;
                }
            }
            return true;
        }
        default:
            throw new Error('Unknown operator: ' + op);
    }
}

/**
 * Evaluates a condition agains a context and returns true if it matches
 */
function evaluateCondition(condition, petType, context) {
    console.info(`Evaluating condition ${JSON.stringify(condition)} over context ${JSON.stringify(context)}`);
    if (!condition) {
        console.info(`Evaluating condition - Null condition: always true`);
        return true;
    }
    if (typeof condition === 'string' || condition instanceof String) {
        // It could be a literal, a macro or a condition name
        const regexp = /{{([a-z_-]*)\.([a-z_-]*)}}/i
        const groups = condition.match(regexp);
        if (groups) {
            if (groups[1] === 'conditions') {
                // Named condition
                const conditionName = groups[2];
                console.info(`Evaluating condition - Named condition ${conditionName}`);
                return evaluateCondition(petType.conditions[conditionName], petType, context);
            } else {
                // Named context param
                const namespace = groups[1];
                const key = groups[2];
                const value = context[namespace] ? context[namespace][key] : undefined;
                console.info(`Evaluating condition - Parameter value ${namespace}.${key} = ${value}`);
                return value;
            }
        } else {
            // Literal
            console.info(`Evaluating condition - Literal value ${condition}`);
            return condition;
        }
    } else {
        const result = evaluateOperator(condition.op, condition.params, petType, context);
        console.info(`Evaluating condition - Result ${result}`);
        return result;
    }
}

/**
 * Finds the first matching conditional response in a set of conditional responses that matches
 * the conditions based on the given context.
 * @param conditionalResponses
 * @param petType
 * @param context
 * @returns a response id
 */
function findConditionalResponse(conditionalResponses, petType, context) {
    for (let conditionalResponseId in conditionalResponses) {
        const conditionalResponse = conditionalResponses[conditionalResponseId];
        console.info(`Found continuation ${JSON.stringify(conditionalResponse)}`);
        if (!evaluateCondition(conditionalResponse.condition, petType, context)) {
            console.info(`Response ${conditionalResponseId} doesn't match condition`);
            continue;
        }
        const responseId = getRandomArrayItem(conditionalResponse.responses);
        console.log(`Located response ${responseId}`);
        return responseId;
    }
    return null;
}

/**
 * Finds a response to an action
 * @param petType metadata of the pet
 * @param action action triggered
 * @param context context information to use to take a decision
 * @returns a response id
 */
function findResponse(petType, action, context) {
    console.info(`Trying to locate a response for action ${action} with context ${JSON.stringify(context)}`);
    if (action) {
        // Find matching response for action and context
        // TODO: Allow for more than one result and randomly pick one.
        for (let reactionId in petType.reactions) {
            const reaction = petType.reactions[reactionId];
            if (reaction.intent !== action) {
                continue;
            }

            console.info(`Found reaction ${JSON.stringify(reaction)}`);
            const responseId = findConditionalResponse(reaction.responses, petType, context);
            if (responseId) {
                return responseId;
            }
        }
        // Find a matching default response (if any)
        const responseId = findConditionalResponse(petType.defaultResponses, petType, context);
        if (responseId) {
            return responseId;
        }
    } else {
        // If no action, find a continuation
        const responseId = findConditionalResponse(petType.continuations, petType, context);
        if (responseId) {
            return responseId;
        }
    }
    // No reaction to any action, no default reactions and no continuations
    return null;
}

function executeResponse(response, petType, context) {
    for (let idx in response.edits) {
        const edit = response.edits[idx];
        console.info(`Executing edit ${JSON.stringify(edit)}`);
        if (edit['clear']) {
            const nameSpace = edit['clear'];
            console.log(`Execute clear ${nameSpace}`);
            delete context[nameSpace];
        }
        if (edit['set']) {
            const nameSpace = edit['set'];
            context[nameSpace] = {};
            for (let key in edit.values) {
                const value = evaluateCondition(edit.values[key], petType, context);
                console.log(`Execute set ${nameSpace}.${key} = ${value}`);
                context[nameSpace][key] = value;
            }
        }
        if (edit['put']) {
            const nameSpace = edit['put'];
            for (let key in edit.values) {
                const value = evaluateCondition(edit.values[key], petType, context);
                console.log(`Execute put ${nameSpace}.${key} = ${value}`);
                context[nameSpace][key] = value;
            }
        }
        if (edit['remove']) {
            const nameSpace = edit['remove']
            for (let idx in edit.values) {
                const key = edit.values[idx];
                console.log(`Execute ${nameSpace}.${key} = null`);
                delete context[nameSpace][key];
            }
        }
        // TODO: Other operations: append, replace, etc.
    }
}

function saveContext(petRef, conversationId, context) {
    const promises = [];
    console.info(`Saving state: ${JSON.stringify(context.state)}`);
    promises.push(petRef.child('state').set(context.state || {}));
    console.info(`Saving context: ${JSON.stringify(context.context)}`);
    promises.push(petRef.child('contexts').child(conversationId).set(context.context || {}));
    console.info(`Saving knowledge: ${JSON.stringify(context.knowledge)}`);
    promises.push(petRef.child('knowledge').set(context.knowledge || {}));
    return Promise.all(promises);
}

/**
 * Replaces all macros in the message by the actual text. Replacements can be obtained from parameters, pet state,
 * knowledge or context, pet metadata or user metadata.
 * The macros would have the following syntax:
 * macro := '{{' name-space '.' key '}}'
 * name-space := { 'pet', 'user', 'knowledge', 'state', 'context', 'params' }
 * @param message message to expand
 * @param context information that can be used to expand the message
 */
function expandMessage(message, context) {
    return mustache.render(message, context);
}

/**
 * Computes a reaction to an action from the user for the given pet and user
 * @param userRef reference to the user
 * @param petRef reference to the pet
 * @param action string identifying the user action
 * @param parameters key/value map of parameters coming along with the action
 * @param conversationId current conversation
 * @return a promise with a message to be delivered
 */
function computeReaction(userRef, petRef, action, parameters, conversationId) {
    console.info(`Evaluating reaction for pet ${petRef} to action ${action} with params ${JSON.stringify(parameters)}`);

    return userRef.once('value').then(user => {
        return petRef.once('value').then(pet => {
            return getPetType(pet.val().petTypeId).then(petType => {
                return {
                    user: user.val(),
                    pet: pet.val(),
                    petType
                }
            });
        });
    }).then(({user, pet, petType}) => {
        console.info(`Found pet ${JSON.stringify(pet)} pet type ${JSON.stringify(petType)}`);
        // Build a decision context
        const context = {
            pet,
            user,
            knowledge: pet.knowledge || {},
            context: pet.contexts ? pet.contexts[conversationId] : {},
            state: pet.state || {},
            params: parameters || {}
        };
        let message = '';
        for (let loops = 0; loops < 10; loops++) {
            // Find the best reaction match
            const responseId = findResponse(petType, action, context);
            if (!responseId) {
                break;
            }
            const response = petType.responses[responseId];
            if (!response) {
                throw new Error(`Missing ${responseId}`);
            }
            console.log(`Using response ${JSON.stringify(response)}`);
            // Mark the action as executed (just in case, to avoid infinite looping)
            action = null;
            // Execute response
            executeResponse(response, petType, context);
            // Pick message
            const phrase = expandMessage(getRandomArrayItem(response.messages), context);
            console.log(`Using message ${phrase}`);
            message = message + (message ? ". " : "") + phrase;
        }
        console.log(`Resulting message: ${message}`);
        return {
            message,
            context
        };
    }).then(({message, context}) => {
        console.info(`Saving context ${JSON.stringify(context)} (before sending message: '${message}'`);
        return saveContext(petRef, conversationId, context).then(() => {
            return {
                message,
                context: context.context ? context.context.expecting : null
            };
        });
    });
}

// Function to send correctly formatted responses to Dialogflow which are then sent to the user
function sendResponse(response, responseToUser) {
    // if the response is a string send it as a response to the user
    if (typeof responseToUser === 'string') {
        let responseJson = {fulfillmentText: responseToUser}; // displayed response
        response.json(responseJson); // Send response to Dialogflow
    } else {
        // If the response to the user includes rich responses or contexts send them to Dialogflow
        let responseJson = {};
        // Define the text response
        responseJson.fulfillmentText = responseToUser.fulfillmentText;
        if (responseToUser.fulfillmentMessages) {
            responseJson.fulfillmentMessages = responseToUser.fulfillmentMessages;
        }
        if (responseToUser.outputContexts) {
            responseJson.outputContexts = responseToUser.outputContexts;
        }
        console.log('Response to Dialogflow: ' + JSON.stringify(responseJson));
        response.json(responseJson);
    }
}

/**
 * Gets or creates a reference to the user
 * @param userId unique identifier of the user
 */
function getOrCreateUser(userId) {
    console.log(`Getting or creating user: ${userId}`);
    const userRef = db.ref('users/' + userId);
    return userRef.once('value').then(user => {
        if (!user.val()) {
            console.log(`User doesn't exists, creating: ${userId}`);
            return userRef.set({
                createdAt: new Date().toISOString()
            }).then(() => {
                return userRef;
            });
        } else {
            console.log(`Found user: ${user.val().createdAt}`)
            return userRef;
        }
    })
}

/*
* Function to handle webhook requests from Dialogflow
*/
function processRequest(request, response) {
    let action = (request.body.queryResult.action) ? request.body.queryResult.action : 'default';
    let parameters = request.body.queryResult.parameters || {};
    let inputContexts = request.body.queryResult.contexts;
    let requestSource = (request.body.originalDetectIntentRequest) ? request.body.originalDetectIntentRequest.source : undefined;
    let session = (request.body.session) ? request.body.session : undefined;
    let userId = (request.body.originalDetectIntentRequest) ? request.body.originalDetectIntentRequest.payload.user.userId : undefined;
    let conversationId = (request.body.originalDetectIntentRequest) ? request.body.originalDetectIntentRequest.payload.conversation.conversationId : undefined;

    // We can't proceed if we can't identify the user
    if (!userId) {
        // TODO: use the 'session' to allow the user to identify itself and the recover the user from there.
        return sendResponse(response, 'Very sorry, but I can\'t recognize you. Without knowing who you are, I can\'t be a good pet for you');
    }

    // Database references
    return getOrCreateUser(userId).then(userRef => {
        return getOrCreatePet(userRef).then(petRef => {
            return {
                userRef,
                petRef
            };
        }).then(({userRef, petRef}) => {
            console.info(`User: ${userRef.key}, pet: ${petRef.key}`);
            return computeReaction(userRef, petRef, action, parameters, conversationId).then(responseToUser => {
                console.info(`Computed response: ${responseToUser.message}`);
                const outputContexts = responseToUser.context ? [
                    {
                        name: `${session}/contexts/${responseToUser.context}`,
                        lifespanCount: 1
                    } ] : null;
                return sendResponse(response, {
                    fulfillmentText: responseToUser.message,
                    outputContexts
                    // TODO: Add reach messages and finishing the conversation.
                });
            });
        });
    }).catch(ex => {
        console.error('Something went wrong', ex);
        return sendResponse(response, 'Something went wrong: ' + ex);
    });
}

exports.dialogflowFirebaseFulfillment = functions.https.onRequest((request, response) => {
    console.info('Dialogflow Request headers: ' + JSON.stringify(request.headers));
    console.info('Dialogflow Request body: ' + JSON.stringify(request.body));
    if (request.body.queryResult) {
        processRequest(request, response);
    } else {
        console.error('Invalid Request');
        return response.status(400).end('Invalid Webhook Request');
    }
    return response;
});
