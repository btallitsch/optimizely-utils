define(['application'], function(application) {
	'use strict';

	application.controller('SearchResultsCtrl', [
		'SearchService',
		'Utils',
		'ContentTypeService',
		'$scope',
		'$rootScope',
		'$location',
		'$routeParams',
		'$timeout',
		'ModalService',
		'configuration',
		'SearchBarService',
		'EntitlementService',
		'TopicService',
		'SearchHistoryMaker',
		'AnalyticsService',
		'MultiselectService',
		'$window',
		'SharedUINodeFunctions',
		'DropdownService',
		'ServiceErrorNotifier',
		'MetricsService',
		'AuthInfoModel',
		'ItemUseOptionsGenerator',
		'CmeDataService',
		'InSourceSearchService',
		'SearchIndexTabs',
		'$filter',
		'PhasedRolloutService',
		'OptimizelyService',
		'NotificationService',
		'CheckEntitlementService',
		'SearchResultsModel',
		function(
			SearchService,
			Utils,
			ContentTypeService,
			$scope,
			$rootScope,
			$location,
			$routeParams,
			$timeout,
			ModalService,
			configuration,
			SearchBarService,
			EntitlementService,
			TopicService,
			SearchHistoryMaker,
			AnalyticsService,
			MultiselectService,
			$window,
			SharedUINodeFunctions,
			DropdownService,
			ServiceErrorNotifier,
			MetricsService,
			AuthInfoModel,
			ItemUseOptionsGenerator,
			CmeDataService,
			InSourceSearchService,
			SearchIndexTabs,
			$filter,
			PhasedRolloutService,
			OptimizelyService,
			NotificationService,
			CheckEntitlementService,
			SearchResultsModel
		) {
			this.isIE7 = $window.isIE7;
			$scope.SearchResultsCtrl = {};

			/**
			 * Assign controller logic to scope
			 * @type {*}
			 */
			$scope.SearchResultsCtrl = $scope.context = this;

			$(window).on('scroll.scrollFinish', Utils.debounce(function(event) {
				var scrollTop = $(this).scrollTop();
				var distance = 100;
				if (scrollTop > distance && ($rootScope.formFactor === $rootScope.FORM_FACTORS.DESKTOP)) {
					$('.results-header').addClass('under-header');
				} else {
					$('.results-header').removeClass('under-header');
				}

			}, 50));

			// record start time for 'pageload'
			var pageLoadStart = Date.now();

			/**
			 * From the array of selections, determine if they all match a given content type
			 *
			 * @param {array} selections
			 * @param {string} type
			 *
			 * @returns {boolean}
			 */
			var areAllSelectionsSameContentType = function(selections, type) {
				var len = selections.length;
				var i;

				for (i = 0; i < len; i += 1) {
					if (selections[i].contenttype !== type) {
						return false;
					}
				}

				return true;
			};

			this.initialSearch = true;

			this.searchRows = configuration.get('app.searchRows');

			this.maxResultsCount = 25000;

			this.filtersOpen = $rootScope.formFactor === $rootScope.FORM_FACTORS.DESKTOP;

			/**
			 * Unique cid shared by all Theriaque drugs, used to distinguish them in search results
			 *
			 * @const {string}
			 */
			this.THERIAQUE_DRUG_CID = '300934';

			var initLanguageTabs = function() {
				/**
				 * @todo Might be worth checking this against both Legacy and Offerings users.
				 * - rstires
				 *
				 * The indexOverride query param is used to determine the currently active tab and
				 * defines the index to be used in the actual search.
				 *
				 * @type {String} [extraParams=GLOBAL]
				 */
				var extraParams = $scope.SearchResultsCtrl.extraParams;
				extraParams.indexOverride = extraParams.indexOverride || 'GLOBAL';

				/**
				 * The initialized object.
				 */
				$scope.SearchResultsCtrl.languageTabs = new SearchIndexTabs();

				/**
				 * Used to hide/show the language tabs.
				 * {Boolean}
				 */
				$scope.SearchResultsCtrl.displayLanguageTabs = $scope.SearchResultsCtrl.languageTabs.displayTabs();

				/**
				 * Sets all of the links to the following bound function. Alternatively we can
				 * use Tabs.setLinkByFn('NAME', fn) for more granular control.
				 */
				$scope.SearchResultsCtrl.languageTabs.setLinks(function onLanguageTabClick(id) {
					$scope.SearchResultsCtrl.languageTabs.setActiveById(id);
					$scope.SearchResultsCtrl.extraParams.indexOverride = id;
					$scope.SearchResultsCtrl.search();
				});

				/**
				 * Sets the active tab on page load.
				 */
				$scope.SearchResultsCtrl.languageTabs.setActiveById(extraParams.indexOverride);

				/**
				 * Sets the inSourceViewData.
				 */
				$scope.inSourceViewData = InSourceSearchService.viewData;
			};

			/**
			 * Initializes the controller
			 */
			this.init = function() {
				// CK-5036: if no search term is present, send user to homepage with notification banner
				if (!$routeParams.term) {
					$location.path('/');
					NotificationService.show(configuration.get('language.search_no_query_provided'));
					return;
				}
				// Redirect user to info site if they are unauthed
				if (AuthInfoModel.isUnauthenticated() && !AuthInfoModel.isUser()) {
					this.loading = true;
					// CKP-196, if user has previously logged in, send them to login page rather than marketing site
					if (AuthInfoModel.get().hasLoggedIn) {
						$rootScope.goToLogin();
						$location.url('/login');
					} else {
						document.location = configuration.get('edition.urlInfoSiteSearch');
					}
					return;
				}

				this.assignRouteParams();
				this.setupDefaults();
				this.setupPagination();

				if (configuration.USE_SEARCH_INDEX_SELECTION) {
					initLanguageTabs();
				}

				this.search(true);
			};

			this.clearFilters = function() {
				var q = {};
				var queryParams = this.queryParams;
				var encodedTerm = encodeURIComponent(encodeURIComponent(SearchService.getSearchTerm()));

				if (queryParams.query) {
					q.query = encodeURIComponent(queryParams.query);
				}

				if (queryParams.indexOverride) {
					q.indexOverride = queryParams.indexOverride;
				}

				$scope.updateURL('search/' + encodedTerm, q);
			};

			/**
			 * Container for eids chosen via the mutiselect function
			 * @type {Array}
			 */
			this.selectedItems = [];

			/**
			 * Tools to be displayed in the toolbar directive
			 * @type {Array}
			 */
			this.toolbarConfig = {
				disabled: true,
				showSave: true,
				showEmail: true,
				showPrint: $rootScope.AuthInfo.uiFeatures.contentPrint,
				showPresentation: $rootScope.AuthInfo.uiFeatures.presentationMaker,
				showCitationExport: $rootScope.AuthInfo.uiFeatures.citationExport
			};

			/**
			 * Tools to be displayed in the Item Toolbar directive (next to each search result item)
			 * @type {Object}
			 */
			// TODO: This is replaced by the Item Use Options Generator service, but breaks Image View/Interstitial if removed.
			this.itemToolbarConfig = {
				showSave: true,
				showPDF: $rootScope.AuthInfo.uiFeatures.contentPDF,
				showEmail: true,
				showPrint: $rootScope.AuthInfo.uiFeatures.contentPrint,
				showPresentation: $rootScope.AuthInfo.uiFeatures.presentationMaker,
				inResults: true,
				isSearchResult: true // KLUDGE: Needed for disambiguation
			};

			/**
			 * Update the search page when the multiselect checkboxes are updated
			 * @param index of clicked result
			 */
			this.updateMultiselect = function(index) {
				MultiselectService.updateMultiselect(this.results, this.selectedItems, index, this.toolbarConfig, this.currentPage);
			};

			/**
			 * Prints selected items, unless they are all of patient education type, at which point send them to the
			 * patient education print screen.
			 *
			 * @returns {boolean}
			 */
			this.printItems = function() {
				/**
				 * Puts the results for the current page back into the results array
				 */
				var resetPrintItems = function() {
					$scope.SearchResultsCtrl.results[$scope.SearchResultsCtrl.currentPage] = temporaryCopyOfResults;
				};

				/**
				 * From results that are set to print, store the data we need to pass as serialized strings in an object.
				 *
				 * @param {array} results
				 *
				 * @returns {object}
				 */
				var serializeEidsForPatientEducationPrint = function(results) {
					var serializedEids = '';

					SharedUINodeFunctions.iterateArray(results, function(item) {
						serializedEids = serializedEids + item.eid + '|';
					});

					serializedEids = serializedEids.substring(0, serializedEids.length - 1);

					return serializedEids;
				};
				var serializedEids;

				// Replaces the currently displayed set of results with the selected results
				var temporaryCopyOfResults = angular.copy($scope.SearchResultsCtrl.results[$scope.SearchResultsCtrl.currentPage]);
				var resultsToPrint = [];
				SharedUINodeFunctions.iterateArray($scope.SearchResultsCtrl.results, function(page) {
					SharedUINodeFunctions.iterateArray(page, function(result) {
						if (result.selected) {
							resultsToPrint.push(result);
						}
					});
				});
				$scope.SearchResultsCtrl.results[$scope.SearchResultsCtrl.currentPage] = resultsToPrint;

				// If all selected items are patient education, send to new controller without printing
				if (areAllSelectionsSameContentType($scope.SearchResultsCtrl.selectedItems, 'PATIENT_HANDOUT') && $rootScope.AuthInfo.uiFeatures.patientEducationPrint) {
					serializedEids = serializeEidsForPatientEducationPrint($scope.SearchResultsCtrl.results[$scope.SearchResultsCtrl.currentPage]);

					$location.path('/patient-education-print/' + serializedEids);

					return false;
				}

				$timeout(window.print, 0);
				$timeout(resetPrintItems, 1);
			};

			/**
			 * Assigns route parameters to controller's scope
			 */
			this.assignRouteParams = function() {
				SearchService.setSearchTerm($routeParams.term);
				$scope.SearchResultsCtrl.searchTerm = SearchService.getSearchTerm();
				this.extraParams = Utils.decodeURIJson($routeParams.extraParams) || angular.copy(configuration.get('DEFAULT_SEARCH_PARAMS'));
			};

			/**
			 * Sets default parameters needed for view
			 */
			this.setupDefaults = function() {
				this.numResultsFound = 0;
				// Need to initialize these so can test for them easily in the partial
				this.bestBetsData = false;
				this.definitionFound = false;
				this.showTopicPreview = false;
				this.selectedContent = false;
				this.currentPage = $location.search().page ? ($location.search().page - 1) : 0;

				// Create the extraParams object if needed
				if (jQuery.isEmptyObject(this.extraParams)) {
					this.extraParams = {};
				}

				// CK-11458 onlyEntitled must be defaulted to true.
				// Otherwise the Content switch at the bottom of the filters defaults to the incorrect value. It should default to "Subscribed Content".
				if (typeof this.extraParams.onlyEntitled === 'undefined' || this.extraParams.onlyEntitled === null) {
					this.extraParams.onlyEntitled = true;
				}

				// Set the individual defaults
				this.extraParams.sortby = this.extraParams.sortby || 'score';
			};

			/**
			 * Set up pagination
			 *
			 * Page change can be triggered by currentPage updating ($watch), or $location.search changing ($routeUpdate event).
			 * Each has to change the other so pageChanged flag is used to avoid recursive calling.
			 */
			this.pageChanged = false;
			this.setupPagination = function() {
				this.unwatchCurrentPage = $scope.$watch('SearchResultsCtrl.currentPage', function(newPage, oldPage) {
					// Do nothing if page hasn't changed (e.g. watch fires onload) or this.search() will handle the data call)
					if (this.loading || (newPage === oldPage)) {
						return;
					}

					if (this.pageChanged) {
						this.pageChanged = false;
					} else {
						this.pageChanged = true;

						// If using the pagination we can kill off any leftover scrollTo
						$location.search('scrollTo', null);

						// Set page in $location, triggering $routeUpdate below
						if (newPage === 0) {
							// No need to have page on the first page
							$location.search('page', null);
						} else {
							// Increment page number by one so it reads nicely in the URL for the user
							$location.search('page', newPage + 1);
						}

						this.newPage(newPage);
					}
				}.bind(this));

				$rootScope.$on('$routeUpdate', function() {
					if (this.pageChanged) {
						this.pageChanged = false;
					} else {
						this.pageChanged = true;

						var newPage = $location.search().page ? ($location.search().page - 1) : 0;

						// Do nothing if page hasn't changed
						if (newPage === this.currentPage) {
							return;
						}

						// Set currentPage
						this.currentPage = newPage;
						this.newPage(newPage);
					}
				}.bind(this));
			};

			this.newPage = function(newPage) {
				// if new page is larger than results array.length then load more
				if (this.results[newPage]) {
					this.currentPage = newPage;

					this.prefetchNextPage();
				} else {
					this.loadingMore = true;

					this.currentPage = newPage;

					this.queryParams.start = SearchService.getSearchQueryStartValue(newPage);

					this.resource = SearchService.get(this.queryParams);

					this.resource.$promise.then(this.onLoadPageResolved, this.onSearchFailed);
				}

				// Focus start of results and scroll to top (must focus first as Chrome scrolls to focus point)
				// (No point animating since current results are removed before loading new ones), which makes the page very short
				$('.j-search-results').attr('tabindex', '-1').focus();
				$('html, body').scrollTop(0);

				// Want to fire analytics every time they view a page (irrespective of them having already viewed it)
				fireDtmEvent();
			};

			this.onLoadPageResolved = function(data) {
				$scope.SearchResultsCtrl.loadingMore = false;
				pageResolved(data, $scope.SearchResultsCtrl.currentPage);
				$scope.SearchResultsCtrl.prefetchNextPage();
			};

			// Load data for the next page
			this.prefetchNextPage = function() {
				var nextPage = this.currentPage + 1;

				// Bail if 'next page' already loaded
				if ($scope.SearchResultsCtrl.results[nextPage]) {
					return;
				}

				this.queryParams.start = SearchService.getSearchQueryStartValue(nextPage);

				// Bail if there is no 'next page'
				if (this.queryParams.start > this.numResultsFound) {
					return;
				}

				this.resource = SearchService.get(this.queryParams);

				// No need for an error function, this is just a nice-to have background load so failure doesn't matter
				$scope.SearchResultsCtrl.resource.$promise.then($scope.SearchResultsCtrl.onPrefetchPageResolved);
			};

			// Similar to onLoadPageResolved(), but works on current page + 1, and only sanitizes data, does not display it
			this.onPrefetchPageResolved = function(data) {
				pageResolved(data, $scope.SearchResultsCtrl.currentPage + 1);
			};

			function pageResolved(data, pageIndex) {
				$scope.SearchResultsCtrl.results[pageIndex] = SearchResultsModel.sanitizeResultData(data, $scope.SearchResultsCtrl.extraParams);
				if ($scope.SearchResultsCtrl.extraParams.hasOwnProperty('onlyEntitled') && !$scope.SearchResultsCtrl.extraParams.onlyEntitled) {
					CheckEntitlementService.checkEntitlementsData($scope.SearchResultsCtrl.results[pageIndex]);
				}
			}
			/**
			 * Readies and dispatches a query for search results
			 */
			this.search = function(initialLoad) {
				this.loading = true;

				// Shortcut to diagnostics index, for use within embedded instances of CK.
				if (SearchService.getSearchTerm() === 'd1agnost1cs') {
					$location.url('/diag');
				}

				$scope.updateSearchBarTerm($scope.SearchResultsCtrl.searchTerm);

				// If already on search page and changing the data (e.g. filter, sort) reset to first page no matter what the URL says
				if (!initialLoad) {
					this.currentPage = 0;
					$location.search('page', null);

					// Reset multiselect for new results sets
					this.selectedItems = [];
					this.toolbarConfig.disabled = true;
				}

				//nullify results so quick-ng-repeat doesn't have object caching issues
				this.results = [];

				this.updateSearchURL();

				//add search term to query params
				this.queryParams.query = SearchService.getSearchTerm();

				this.queryParams.indexOverride = $scope.SearchResultsCtrl.extraParams.indexOverride;

				// Set start if not on first page
				this.queryParams.start = SearchService.getSearchQueryStartValue(this.currentPage);

				// If section search results, we need to enable grouping
				if (configuration.INCLUDE_SECTION_SEARCH) {
					this.queryParams.group = true;
				}

				// If a section rollup link is clicked, disable grouping
				if ($location.search().group === 'false') {
					this.queryParams.group = false;
				}

				// Add the 'fullTextOnly' search flag if Journal superset (MEDLINE) is inactive
				if (!$rootScope.activeFilterSupersets['+contenttype:JL']) {
					this.queryParams.fullTextOnly = true;
				}

				//CK-1469: if query came in via HL7, include HL7 fields in search request for logging
				if ($location.search().hl7) {
					this.queryParams = angular.extend(this.queryParams, $location.search());
				}

				this.showHideLayout();

				// Make query params accessible from within search resolved success handler
				$scope.queryParams = this.queryParams;

				this.resource = SearchService.get(this.queryParams);

				this.resource.$promise.then(this.onSearchResolved, this.onSearchFailed);

				// if user is logged in or HL7 user, record search query in CME credit log service
				if (AuthInfoModel.isUser() || AuthInfoModel.isHl7User()) {
					CmeDataService.setSessionId(SearchService.getSearchTerm());
				}
				// set data after
				this.assignInSourceOptions(this.queryParams);
			};

			// convenience method for disambiguation/spellcheck terms
			this.searchForSuggestion = function(term, originalSearchTerm, keepDisambiguationActive) {
				// Fire metrics before didyoumean data is cleared
				var type = false;
				if (!$scope.SearchResultsCtrl.didyoumean) {
					type = 'MultiConcept';
				} else if ($scope.SearchResultsCtrl.didyoumean.message === 'spelling') {
					type = 'Spelling';
				} else if ($scope.SearchResultsCtrl.didyoumean.message === 'ambiguous') {
					type = 'SingleConcept';
				}
				MetricsService.createEvent(
					'Search',
					'Click',
					originalSearchTerm,
					{
						label: 'SearchDisambiguation',
						metadata:
						{
							type: type,
							clickedSuggestion: term
						}
					}
				);
				$scope.SearchResultsCtrl.searchTerm = SearchService.getSearchTerm();
				$scope.updateSearchBarTerm(term);
				SearchService.setSearchTerm(term);
				// prevent spellcheck loops - this will be set back by service after search is executed
				// however, if there are multiple ambiguous terms, we should not suppress disambiguation
				// on the subsequent search
				SearchService.excludeDisambiguation = keepDisambiguationActive ? false : true;

				// Clean out the existing didyoumean data
				$scope.SearchResultsCtrl.didyoumean = false;

				$scope.SearchResultsCtrl.updateSearchURL();
			};

			this.updateSearchURL = function() {
				// create new queryParams
				this.queryParams = {};

				// clean and add extra params to queryParams if needed
				if (this.extraParams) {
					this.extraParams = Utils.removeEmptyFields(this.extraParams);
					angular.extend(this.queryParams, this.extraParams);
				}

				//remove default fields from query params so they don't show up in the URL or query
				this.queryParams = Utils.removeMatchingFields(this.queryParams, configuration.get('DEFAULT_SEARCH_PARAMS'));

				//update URL with new parameters
				if (!this.initialSearch) {
					// Encode search term so chars like '/' don't interfere with routing - as per search bar controller
					var encodedTerm = encodeURIComponent(encodeURIComponent(SearchService.getSearchTerm()));

					// Encode the query queryParams to prevent 404 CK-7699
					if (this.queryParams.query) {
						//this.queryParams.query = encodeURIComponent(this.queryParams.query);
						delete this.queryParams.query;
					}
					/**
					 * @todo May require change. I just dont know...
					 * Legacy will support this, but offerings will not. Safe bet is to remove.
					 * - rstires
					 *
					 */
					// CK-8155 Prevent adding indexOverride if set to default (GLOBAL).
					this.queryParams = Utils.removeKeyIfEquals('indexOverride', 'GLOBAL', this.queryParams);

					// suppressReload true argument removed due to CKUI-707
					$scope.updateURL('search/' + encodedTerm, this.queryParams);
				}
				this.initialSearch = false;
			};

			/**
			 * Launch modal with an explanation of the Patient Context
			 */
			this.hl7Explanation = function() {
				ModalService.createWithoutPromise(
					{
						modalString: $scope.Messages.patient_context_explanation,
						successLabel: $scope.Messages.patient_context_explanation_dismiss,
						hideCancelButton: true
					});
			};

			/**
			 * Open the filter column to full width
			 */
			this.openFilterColumn = function() {
				$scope.SearchResultsCtrl.filtersOpen = true;
			};

			/**
			 * Remove hl7 from the search
			 */
			this.hl7Close = function() {
				$('.j-patient-context').hide(); // Just a nicety that makes closing the box feel more responsive
				$location.search('');
				this.search();
			};

			/**
			 * Promise resolution for new search
			 * (Do not call manually)
			 * @param data
			 */
			this.onSearchResolved = function(data) {

				var timeFacets = data.facets ? data.facets.Time : [];

				// If we have a successful hl7 search response, make the query from the response available
				if ($location.search().hl7) {
					$rootScope.$broadcast('hl7SearchSuccess', data.resultMetadata.query);
				}

				// Store search history if properly authenticated
				if (AuthInfoModel.isUser()) {
					$routeParams.extraParams = $scope.queryParams.facetquery ? SearchResultsModel.transformQueryParamFacetQueryToRouteParamFacetQuery($scope.queryParams.facetquery) : this.extraParams;
					SearchHistoryMaker.setFacetData(data.facets);
					SearchHistoryMaker.createSearchHistory($routeParams);
				}
				$scope.SearchResultsCtrl.results[$scope.SearchResultsCtrl.currentPage] = SearchResultsModel.sanitizeResultData(data, $scope.SearchResultsCtrl.extraParams);

				// Add best bets data to scope if present
				if (data.bestbets) {
					SharedUINodeFunctions.iterateArray(data.bestbets, function(bet) {
						// Format date nicely: month dd, yyyy
						if (bet.pubdate) {
							var utcDate = Utils.convertToUTC(parseInt(bet.pubdate));
							bet.pubdateLong = $filter('date')(new Date(utcDate), 'longDate');
						}
					});

					$scope.SearchResultsCtrl.bestBetsData = data.bestbets;
				}

				// Optimizely CK-13081: adjust best bets placement if variation is active
				if (OptimizelyService.isVariationActive('AllBestBets', 'changeAllBestBetsPlacement')) {
					$scope.SearchResultsCtrl.changeBestBetsPlacement = true;
				}
				// Optimizely CK-13232 changeBestBetsThumbnailSize
				if (OptimizelyService.isVariationActive('AllBestBets', 'changeBestBetsThumbnailSize')) {
					$scope.SearchResultsCtrl.changeBestBetsThumbnailSize = true;
				}

				// Add selected content if present
				if (data.selectedContent) {
					$scope.SearchResultsCtrl.selectedContent = data.selectedContent;
				}

				if (data.topicpages) {

					// CK-10989 the topicpages have no notion of entitlement, so we have to manually remove and re-order these results based on the BNF fence.
					// TODO: This code should be extracted to a model class that transforms this data
					if (data.topicpages['topic-type'] === 'drug' && data.topicpages.generalist && data.topicpages.generalist.length > 0) {
						if ($rootScope.AuthInfo.uiFeatures.displayBNFContent) {
							// If BNF, make any BNF topicpages appear first
							var bnfTopicPages = [];
							var otherTopicPages = [];
							SharedUINodeFunctions.iterateArray(data.topicpages.generalist, function(item, index) {
								if (/BNF/.test(item.provider)) {
									data.topicpages.generalist[index].srctype = 'DM';
									bnfTopicPages.push(item);
								} else {
									otherTopicPages.push(item);
								}
							});
							data.topicpages.generalist = bnfTopicPages.concat(otherTopicPages);
						} else {
							// If not BNF, remove all BNF topicpages
							data.topicpages.generalist = data.topicpages.generalist.filter(function(item) {
								return !/BNF/.test(item.provider);
							});
						}
					}
					data.topicpages.originalSearch = $scope.SearchResultsCtrl.searchTerm;
					TopicService.setTopicData(data.topicpages);

					// TODO Remove topic redirect code and conditions now everyone uses topic preview
					if (configuration.get('edition.showTopicPreview') || PhasedRolloutService.isFeatureActive($rootScope.AVAILABLE_FEATURES.SPANISH_TOPIC_PREVIEW)) {
						// Make sure the topic preview is shown when returning to results from content (CKUI-225)
						$scope.SearchResultsCtrl.showTopicPreview = true;
					} else {
						// Otherwise redirect to full topic page
						$location.url('/topic/' + encodeURIComponent(encodeURIComponent(data.topicpages.topic))).replace();
						return;
					}
				}

				$scope.SearchResultsCtrl.didyoumean = $.isEmptyObject(data.didyoumean) ? null : data.didyoumean;
				$scope.SearchResultsCtrl.disambiguations = $.isEmptyObject(data.disambiguations) ? null : data.disambiguations;
				$scope.SearchResultsCtrl.showDisambiguations = $scope.SearchResultsCtrl.didyoumean || $scope.SearchResultsCtrl.disambiguations;
				$scope.updateSearchBarTerm($scope.SearchResultsCtrl.searchTerm);
				$rootScope.setPageTitleData($scope.SearchResultsCtrl.searchTerm, 'title_suffix_search');
				$scope.SearchResultsCtrl.loading = false;
				$scope.SearchResultsCtrl.numResultsFound = data.numberfound || 0;
				$scope.SearchResultsCtrl.isHl7 = $location.search().hl7;
				$scope.SearchResultsCtrl.hl7Metadata = $scope.SearchResultsCtrl.isHl7 ? SearchService.transformHl7SearchMetadata(data.resultMetadata, $rootScope.Messages) : false;

				if (data.resultsanalysis) {
					$scope.SearchResultsCtrl.refinements = data.resultsanalysis.refinements;
				}

				if (data.numberfound > 0) {
					$scope.SearchResultsCtrl.facetquery = data.facets;
				}

				$scope.SearchResultsCtrl.selectedFacets = $scope.SearchResultsCtrl.extraParams.facetquery;

				$scope.SearchResultsCtrl.showHideLayout();

				// Check entitlements
				if ($scope.SearchResultsCtrl.extraParams.hasOwnProperty('onlyEntitled') && !$scope.SearchResultsCtrl.extraParams.onlyEntitled) {
					CheckEntitlementService.checkEntitlementsData($scope.SearchResultsCtrl.results[$scope.SearchResultsCtrl.currentPage]);
				}

				// Now first page is done with, prefetch data for next page
				$scope.SearchResultsCtrl.prefetchNextPage();

				// Count the number of times the 'Try this search with no filters' link is offered
				if (data.numberfound === 0 && $scope.SearchResultsCtrl.selectedFacets) {
					MetricsService.createEvent(
						'Search',
						'Rendered',
						'',
						{
							label: 'FilteredNoResults',
							metadata:
							{
								query: $scope.SearchResultsCtrl.searchTerm,
								facetQuery: $scope.SearchResultsCtrl.selectedFacets,
								onlyEntitled: $scope.SearchResultsCtrl.extraParams.onlyEntitled
							}
						}
					);
				}

				var eventMetadata = $scope.SearchResultsCtrl.extraParams;
				eventMetadata.query = $scope.SearchResultsCtrl.searchTerm;

				MetricsService.createEvent(
					'Search',
					'ResultsReturned',
					$scope.SearchResultsCtrl.numResultsFound,
					{
						metadata: eventMetadata
					}
				);

				// Update the inactive index counts.
				if ($scope.SearchResultsCtrl.displayLanguageTabs) {
					$scope.SearchResultsCtrl.languageTabs.updateTabCounts(data, updateInactiveLanguageTabs);
				}
				fireDtmEvent();
			}.bind(this);

			var updateInactiveLanguageTabs = function(tab) {
				var params = angular.extend({}, $scope.SearchResultsCtrl.queryParams);

				params.start = 0;
				params.rows = 0;
				params.fields = 'sectionids';
				params.sections = 'results';
				params.indexOverride = tab.id;

				// CK-12704 - Never try to expand search results for this kind of search
				delete params.showExpandedResult;

				return SearchService.get(params).$promise
					.then(function(data) {
						return angular.extend({}, data, {
							language: tab.id
						});
					});
			};


			/**
			 * CKSD-53: Set in source search options into search dropdown if available
			 */
			this.assignInSourceOptions = function(data) {
				if (data.filterquery && data.facetquery) {
					switch (data.facetquery[0]) {
						case '+contenttype:BK':
							InSourceSearchService.showSearchBarOptions(
								{
									inSource: [
										{
											name: $scope.Messages.search_book,
											data:
											{
												facetquery: data.facetquery,
												filterquery: data.filterquery
											}
										}]
								});
							break;
						case '+contenttype:JL':
							if (angular.isArray(data.filterquery)) {
								// show both "This Issue" and "This Journal" when searching within "This Issue"
								InSourceSearchService.showSearchBarOptions(
									{
										inSource: [
											{
												name: $scope.Messages.search_issue,
												data:
												{
													facetquery: data.facetquery,
													filterquery: data.filterquery[1]
												}
											},
											{
												name: $scope.Messages.search_journal,
												data:
												{
													facetquery: data.facetquery,
													filterquery: data.filterquery[0]
												}
											}]
									});
							} else {
								// Otherwise, show only "This Journal"
								InSourceSearchService.showSearchBarOptions(
									{
										inSource: [
											{
												name: $scope.Messages.search_journal,
												data:
												{
													facetquery: data.facetquery,
													filterquery: data.filterquery
												}
											}]
									});
							}
							break;
						case '+contenttype:EM':
							if (angular.isArray(data.filterquery)) {
								// show both "This issue" and This emc" when searching within "This issue"
								InSourceSearchService.showSearchBarOptions(
									{
										inSource: [
											{
												name: $scope.Messages.search_emc_issue,
												data:
												{
													facetquery: data.facetquery,
													filterquery: [data.filterquery[0] + data.filterquery[1]]
												}
											},
											{
												name: $scope.Messages.search_emc,
												data:
												{
													facetquery: data.facetquery,
													filterquery: data.filterquery[0]
												}
											}]
									});
							} else {
								// Otherwise, show only "This emc"
								InSourceSearchService.showSearchBarOptions(
									{
										inSource: [
											{
												name: $scope.Messages.search_emc,
												data:
												{
													facetquery: data.facetquery,
													filterquery: data.filterquery
												}
											}]
									});
							}
							break;
						default:
							InSourceSearchService.hideSearchBarOptions();
					}
				} else {
					InSourceSearchService.hideSearchBarOptions();
				}
			};

			function resultCounts(data) {
				return data.numberfound || data.totalCount;
			}

			var fireDtmEvent = function() {
				var formattedFacets;
				if ($scope.SearchResultsCtrl.extraParams.facetquery) {
					formattedFacets = [];
					SharedUINodeFunctions.iterateArray($scope.SearchResultsCtrl.extraParams.facetquery, function(facet) {
						formattedFacets.push(facet.split(':'));
					});
				}
				AnalyticsService.fireEvent(AnalyticsService.EVENT_TYPES.SEARCH_RESULTS_UPDATED,
					{
						search:
						{
							typedTerm: $scope.SearchResultsCtrl.searchTerm,
							criteria: $scope.SearchResultsCtrl.searchTerm,
							currentPage: Math.floor($scope.SearchResultsCtrl.queryParams.start || 0 / $scope.SearchResultsCtrl.searchRows),
							facets: formattedFacets,
							resultsPerPage: $scope.SearchResultsCtrl.searchRows,
							sortType: $scope.SearchResultsCtrl.extraParams.sortby,
							totalResults: $scope.SearchResultsCtrl.numResultsFound
						}
					});
			};

			/**
			 * Error handler for failed search queries
			 * (Do not call manually)
			 * @param error
			 */
			this.onSearchFailed = function(error) {
				if (error.status === 403) {
					// Offerings user is not entitled to HL7 search
					var removeRouteChangeListener = $rootScope.$on('$routeChangeSuccess', function() {
						ModalService.create({
							modalString: configuration.language.modal_feature_not_available,
							hideCancelButton: true
						});
						removeRouteChangeListener();
					});

					$location.url('/');
				} else {
					myDebugger.log('SearchResultsCtrl:onSearchFailed', 'Search failed: ', error);

					ServiceErrorNotifier.handleServiceError(error);

					$scope.SearchResultsCtrl.loading = false;

					var err;
					if (error instanceof Error) {
						err = error.toString();
					} else {
						try {
							err = JSON.stringify(error);
						} catch (e) {
							err = error.toString();
						}
					}

					AnalyticsService.trackPage(Date.now() - pageLoadStart, Date.now(), 'search', AnalyticsService.PAGE_TYPES.SEARCH, err);
				}
			};

			/**
			 * Sets sort type when a sort option is clicked
			 * @param sortType
			 */
			this.sortBy = function(sortType) {
				DropdownService.hideAll();

				//if current sort type is clicked, do nothing
				if (sortType === this.extraParams.sortby) {
					return;
				}

				this.extraParams.sortby = sortType;
				this.updateSearchURL();
			};

			/**
			 * Applies facet values from filter directive to controller's scope for use in queries
			 * (Passed into filter directive)
			 * @param facets
			 */
			this.applyFacets = function(facets) {
				$scope.SearchResultsCtrl.extraParams.facetquery = facets;
				$scope.SearchResultsCtrl.updateSearchURL();
			};

			this.showHideLayout = function() {
				var sourcesCount = 0;
				$(this.extraParams.facetquery).each(function(index, value) {
					if (value.indexOf('+contenttype:') !== -1) {
						sourcesCount++;
					}
				});
				var containsImages = $.inArray('+contenttype:IM', this.extraParams.facetquery) !== -1;
				var containsVideos = $.inArray('+contenttype:VD', this.extraParams.facetquery) !== -1;

				this.showLayout = (containsImages && sourcesCount === 1) || (containsVideos && sourcesCount === 1) || (containsImages && containsVideos && sourcesCount === 2);

				// Show grid by default for image and/or video only searches
				this.layout = this.showLayout ? 'grid' : 'list';
			};

			this.hasDisambiguation = function(data) {
				if (!data.didyoumean) {
					return false;
				}
				return data.didyoumean.message === 'ambiguous';
			};

			this.hasSpellCheck = function(data) {
				if (!data.didyoumean) {
					return false;
				}
				return data.didyoumean.message === 'spelling';
			};

			this.subscribeFilterClicked = function() {
				DropdownService.hideAll();

				var ctrl = $scope.SearchResultsCtrl;
				ctrl.extraParams.onlyEntitled = !ctrl.extraParams.onlyEntitled;
				ctrl.updateSearchURL();
			};

			this.auContentOnlyFilterClicked = function() {
				var ctrl = $scope.SearchResultsCtrl;
				if (ctrl.extraParams.hasOwnProperty('auContentOnly') && ctrl.extraParams.auContentOnly === true) {
					delete ctrl.extraParams.auContentOnly;
				} else {
					ctrl.extraParams.auContentOnly = true;
				}

				ctrl.updateSearchURL();
			};

			this.getLangCode = function() {
				return configuration.languageCode && configuration.languageCode.split('_')[0];
			};

			/* Begin toolbar functions */

			// helper function to create data object for result
			this.formatResultData = function(result) {
				return {
					itemtitle: result.itemtitle + ' - ' + result.sourcetitle,
					eid: result.eid,
					contenttype: result.contenttype,
					pdfFilename: result.pdfeid
				};
			};
			// Handle result printing but isolate from images so that we can handle images with our image directives
			this.printItem = function(element, itemData) {
				if (itemData.contenttype !== 'IMAGE') {
					var url = '#!/content/' + ContentTypeService.sanitizeSrcType(itemData.contenttype) + '/' + itemData.eid + '?printContent';
					if (itemData.searchIndex && itemData.searchIndex !== 'GLOBAL') {
						url += '&indexOverride=' + itemData.searchIndex;
					}
					var ckPrintWin = $window.open(url);
				} else {
					// TODO: Decouple image printing from search results.
					element.scope().loadPartialForPrint();
				}
			};

			this.selectSearchIndex = function(index) {
				$scope.SearchResultsCtrl.searchIndex = index;
				$scope.SearchResultsCtrl.search();
			};

			// Set up back to results link
			this.resultClicked = function(index) {
				// Amend history object so back button behaves like "Back to results" link
				$location.search('scrollTo', '#result-' + index).replace();

				$rootScope.$broadcast('search-result-clicked', 'result-' + index, window.location.hash, ($scope.SearchResultsCtrl.currentPage + 1));
			};

			// Kill currentPage watcher when destroyed
			// Note this is erroneously, but harmlessly fired whenever search() is called because the rate results controller is destroyed when .loading is true.
			$scope.$on('$destroy', function() {
				InSourceSearchService.hideSearchBarOptions();
				// only call this if it has had a chance to be created
				if ($scope.SearchResultsCtrl.unwatchCurrentPage) {
					$scope.SearchResultsCtrl.unwatchCurrentPage();
				}
			});

			/**
			 * Begin controller initialization
			 * but only if we're not already performing a search
			 */
			if (!this.loading) {
				this.init();
			}
		}
	]);
});
