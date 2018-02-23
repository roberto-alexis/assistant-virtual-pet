'use strict';

const assert = require('assert');

let myFunctions, configStub, adminInitStub, functions, admin;

exports.assertReaction = function(userId, action, parameters, expectedMessage) {
    const req = {
        request: {
            body: {
                queryResult: {
                    action,
                    parameters
                },
                originalDetectIntentRequest: {
                    payload: {
                        user: {
                            userId
                        }
                    }
                }
            }
        }
    };

    const res = {
        json: (content) => {
            assert(expectedMessage, content.fulfillmentText);
        }
    };

    myFunctions.dialogflowFirebaseFulfillment(req, res);
};

exports.mockDb = function() {
    admin = require('firebase-admin');
    adminInitStub = sinon.stub(admin, 'initializeApp');
    functions = require('firebase-functions');
    configStub = sinon.stub(functions, 'config').returns({
        firebase: {
            databaseURL: 'https://not-a-project.firebaseio.com',
            storageBucket: 'not-a-project.appspot.com',
        }
        // You can stub any other config values needed by your functions here, for example:
        // foo: 'bar'
    });
    // Now we can require index.js and save the exports inside a namespace called myFunctions.
    // This includes our cloud functions, which can now be accessed at myFunctions.makeUppercase
    // and myFunctions.addMessage
    myFunctions = require('../index');
};

exports.unMockDb = function() {
    configStub.restore();
    adminInitStub.restore();
};
