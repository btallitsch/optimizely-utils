/**
 * OptimizelyService
 *
 * Internal library of Optimizely needed methods.
 *
 * The Optimizely documentation isn't exactly clear on what "active" means in many instances
 * "Active" experiments actually mean the ones that have a status of "Running"
 * optimizely.variationNamesMap returns a map of enabled variations you are seeing on a particular page
 * isVariationActive below, checks if you are seeing a specific variation in a particular experiment
 *
 */
define(['application'], function(application) {
	'use strict';

	application.service('OptimizelyService', [
		'$rootScope',
		function(
			$rootScope
		) {
			var optimizely = window.optimizely || {};

			/**
			 * Returns list of currently running experiments
			 *
			 * @returns {array}
			 */
			this.getActiveExperimentList = function() {
				var activeExperiments = [];
				angular.forEach(optimizely.allExperiments, function(experiment) {
					if (experiment.enabled === true) {
						activeExperiments.push(experiment.name);
					}
				});
				return activeExperiments;
			};

			/**
			 * Checks if an experiment is running, when passed in an experiment name
			 *
			 * @param {string} name
			 *
			 * @returns {boolean}
			 */
			this.isExperimentActive = function(name) {
				var all = optimizely.data.experiments;
				var active = optimizely.activeExperiments;
				for (active in all) {
					if (all[active].name === name) {
						return true;
					}
				}
				return false;
			};

			/**
			 * Returns the ID of a given experiment name
			 *
			 * @param {string} name
			 *
			 * @returns {string | boolean}
			 */
			this.getExperimentIdByName = function(name) {
				var all = optimizely.allExperiments;
				for (var key in all) {
					if (all[key].name === name) {
						return key;
					}
				}
				return false;
			};

			/**
			 * Check to see if a variation in a given experiment is active
			 *
			 * @param {string} experiment
			 * @param {string} variation
			 *
			 * @returns {boolean}
			 */
			this.isVariationActive = function(experiment, variation) {
				var experimentID = this.getExperimentIdByName(experiment);
				if (!experimentID) {
					return false;
				}
				var variationName = optimizely.variationNamesMap[experimentID];
				if (this.isExperimentActive(experiment) && variationName === variation) {
					return true;
				}
				return false;
			};

			/**
			 * Fires event based on custom event name
			 *
			 * @param {string} eventName
			 *
			 * @returns {boolean}
			 */
			this.fireEvent = function(eventName) {
				if (!eventName) {
					myDebugger.log('Event name must be specified!');
					return;
				} else {
					optimizely.push(['trackEvent', eventName]);
				}
			};
		}
	]);
});
