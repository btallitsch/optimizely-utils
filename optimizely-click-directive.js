define(['application'], function(application) {
	'use strict';
	application.directive('ckOptimizelyClick', ['OptimizelyService',
		function(OptimizelyService) {
			return {
				restrict: 'A',
				link: function(scope, element, attrs) {
					element.on('click', function(event) {
						var data = attrs.ckOptimizelyClick;
						if (data) {
							OptimizelyService.fireEvent(data);
						}
					});
					// clean up on destruction
					element.on('$destroy', function() {
						element.off('click');
					});
				}
			};
		}
	]);
});
